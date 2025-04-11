const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const input = require('input');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const config = require('../config/config');

// Path to save the session
const DATA_DIR = path.join(__dirname, '../data');
const SESSION_FILE_PATH = path.join(DATA_DIR, 'telegram-session.txt');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Client instance
let client = null;

/**
 * Initialize the Telegram client
 */
function initClient() {
  if (client) return client;
  
  // Check if session exists
  let sessionData = '';
  if (fs.existsSync(SESSION_FILE_PATH)) {
    sessionData = fs.readFileSync(SESSION_FILE_PATH, 'utf8');
  }

  const stringSession = new StringSession(sessionData);

  // Initialize the Telegram client
  client = new TelegramClient(
    stringSession,
    config.telegram.apiId,
    config.telegram.apiHash,
    { connectionRetries: 5 }
  );
  
  return client;
}

/**
 * Connect to Telegram
 */
async function connectClient() {
  if (!client) {
    initClient();
  }
  
  // Login to Telegram
  await client.start({
    phoneNumber: async () => config.telegram.forwarderPhoneNumber || await input.text('Please enter your phone number: '),
    password: async () => await input.text('Please enter your password: '),
    phoneCode: async () => await input.text('Please enter the code you received: '),
    onError: (err) => logger.error('Login error:', err),
  });
  
  // Save the session for future use
  const sessionString = client.session.save();
  fs.writeFileSync(SESSION_FILE_PATH, sessionString);
  logger.info(`Session saved to ${SESSION_FILE_PATH}`);
  
  logger.info('Connected to Telegram!');
  
  return client;
}

/**
 * Disconnect from Telegram
 */
async function disconnectClient() {
  if (client) {
    await client.disconnect();
    client = null;
    logger.info('Disconnected from Telegram');
  }
}

/**
 * Get the Telegram client instance
 */
function getClient() {
  if (!client) {
    throw new Error('Telegram client not initialized. Call initClient() first.');
  }
  return client;
}

module.exports = {
  initClient,
  connectClient,
  disconnectClient,
  getClient
};