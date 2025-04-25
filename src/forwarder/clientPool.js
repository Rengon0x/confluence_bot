// src/forwarder/clientPool.js
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const config = require('../config/config');

// Path to save sessions
const DATA_DIR = path.join(__dirname, '../../data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Map to store clients by ID
const clients = new Map();

/**
 * Initialize a Telegram client with its own parameters
 * @param {Object} forwarderConfig - Forwarder configuration
 * @returns {TelegramClient} - Initialized Telegram client
 */
function initClient(forwarderConfig) {
  const sessionFilePath = path.join(DATA_DIR, forwarderConfig.sessionPath);
  
  // Check if session exists
  let sessionData = '';
  if (fs.existsSync(sessionFilePath)) {
    sessionData = fs.readFileSync(sessionFilePath, 'utf8');
  }

  const stringSession = new StringSession(sessionData);
  
  // Initialize the Telegram client
  const client = new TelegramClient(
    stringSession,
    forwarderConfig.apiId,
    forwarderConfig.apiHash,
    { connectionRetries: 5 }
  );
  
  return client;
}

/**
 * Connect a Telegram client
 * @param {Object} forwarderConfig - Forwarder configuration
 * @returns {Promise<TelegramClient>} - Connected Telegram client
 */
async function connectClient(forwarderConfig) {
  const client = clients.get(forwarderConfig.id) || initClient(forwarderConfig);
  
  // Store the client in the map
  clients.set(forwarderConfig.id, client);
  
  const sessionFilePath = path.join(DATA_DIR, forwarderConfig.sessionPath);
  
  // Login to Telegram
  await client.start({
    phoneNumber: async () => forwarderConfig.phoneNumber || await input.text(`[${forwarderConfig.id}] Please enter your phone number: `),
    password: async () => await input.text(`[${forwarderConfig.id}] Please enter your password: `),
    phoneCode: async () => await input.text(`[${forwarderConfig.id}] Please enter the code you received: `),
    onError: (err) => logger.error(`[${forwarderConfig.id}] Login error:`, err),
  });
  
  // Save the session for future use
  const sessionString = client.session.save();
  fs.writeFileSync(sessionFilePath, sessionString);
  logger.info(`[${forwarderConfig.id}] Session saved to ${sessionFilePath}`);
  
  logger.info(`[${forwarderConfig.id}] Connected to Telegram!`);
  
  return client;
}

/**
 * Connect all configured clients
 * @returns {Promise<Map<string, TelegramClient>>} - Map of connected clients
 */
async function connectAllClients() {
  const forwarders = config.telegram.forwarders || [];
  
  if (forwarders.length === 0) {
    throw new Error('No forwarders configured!');
  }
  
  logger.info(`Connecting ${forwarders.length} forwarder clients...`);
  
  for (const forwarderConfig of forwarders) {
    try {
      await connectClient(forwarderConfig);
      logger.info(`Successfully connected forwarder: ${forwarderConfig.id}`);
    } catch (err) {
      logger.error(`Failed to connect forwarder ${forwarderConfig.id}:`, err);
    }
  }
  
  return clients;
}

/**
 * Get a client based on a distribution algorithm
 * Simple hash-based assignment for now
 * @param {string} trackerName - Name of the tracker
 * @returns {TelegramClient} - Telegram client to use
 */
function getClientForTracker(trackerName) {
  if (clients.size === 0) {
    throw new Error('No forwarder clients available');
  }
  
  // Simple hash to always assign the same client to a tracker
  const clientIds = Array.from(clients.keys());
  const hashCode = Array.from(trackerName).reduce(
    (hash, char) => ((hash << 5) - hash) + char.charCodeAt(0), 0
  );
  const index = Math.abs(hashCode) % clientIds.length;
  
  const clientId = clientIds[index];
  return clients.get(clientId);
}

/**
 * Disconnect all clients
 */
async function disconnectAllClients() {
  for (const [id, client] of clients.entries()) {
    try {
      await client.disconnect();
      logger.info(`Disconnected forwarder: ${id}`);
    } catch (err) {
      logger.error(`Error disconnecting forwarder ${id}:`, err);
    }
  }
  clients.clear();
}

module.exports = {
  initClient,
  connectClient,
  connectAllClients,
  getClientForTracker,
  disconnectAllClients,
  getAllClients: () => clients
};