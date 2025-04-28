// src/forwarder/index.js
require('dotenv').config();
const logger = require('../utils/logger');
const db = require('../db');
const { connectAllClients, disconnectAllClients } = require('./clientPool');
const { setupMessageHandler } = require('./messageHandler');
const { updateMonitoredTrackers } = require('./utils');
const shutdownManager = require('../utils/shutdownManager');

/**
 * Initialize and start the forwarder
 */
async function startForwarder() {
  try {
    // Initialize and connect all Telegram clients
    await connectAllClients();
    
    // Set up the global message handler
    setupMessageHandler();
    
    // Connect to database if not already connected
    await db.connectToDatabase();
    
    // Start monitoring all active trackers
    await updateMonitoredTrackers();
    
    // Periodically check for new trackers to monitor
    const updateInterval = setInterval(updateMonitoredTrackers, 60000); // Check every minute
    
    logger.info('Forwarder is now running with client pool.');
    
    // Register shutdown callback
    shutdownManager.registerCallback(async () => {
      clearInterval(updateInterval);
      await stopForwarder();
    }, 'forwarder');
    
    return {
      stop: async () => {
        clearInterval(updateInterval);
        await stopForwarder();
      }
    };
  } catch (error) {
    logger.error('Failed to start forwarder:', error);
    throw error;
  }
}

/**
 * Stop the forwarder gracefully
 */
async function stopForwarder() {
  logger.info('Stopping forwarder...');
  
  // Clear all trackers
  require('./utils').monitoredTrackers.clear();
  
  // Disconnect from Telegram
  await disconnectAllClients();
  
  logger.info('Forwarder stopped.');
}

module.exports = {
  startForwarder,
  stopForwarder
};