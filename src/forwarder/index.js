require('dotenv').config();
const logger = require('../utils/logger');
const db = require('../db');
const { initClient, connectClient, disconnectClient } = require('./client');
const { setupMessageHandler } = require('./messageHandler');
const { monitoredTrackers, updateMonitoredTrackers } = require('./utils');

/**
 * Initialize and start the forwarder
 */
async function startForwarder() {
  logger.info('Starting Multi-Tracker Forwarder...');
  
  try {
    // Initialize and connect Telegram client
    initClient();
    await connectClient();
    
    // Set up the global message handler
    setupMessageHandler();
    
    // Connect to database if not already connected
    await db.connectToDatabase();
    
    // Start monitoring all active trackers
    await updateMonitoredTrackers();
    
    // Periodically check for new trackers to monitor
    const updateInterval = setInterval(updateMonitoredTrackers, 60000); // Check every minute
    
    logger.info('Forwarder is now running.');
    
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
  monitoredTrackers.clear();
  
  // Disconnect from Telegram
  await disconnectClient();
  
  logger.info('Forwarder stopped.');
}

// Handle application shutdown
process.on('SIGINT', async () => {
  logger.info('Received SIGINT signal');
  await stopForwarder();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM signal');
  await stopForwarder();
  process.exit(0);
});

// Start the forwarder if this file is run directly
if (require.main === module) {
  startForwarder().catch(error => {
    logger.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = {
  startForwarder,
  stopForwarder
};