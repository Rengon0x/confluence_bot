require('dotenv').config();
const logger = require('./utils/logger');
const db = require('./db');
const { startBot } = require('./bot');

/**
 * Main application entry point
 */
async function startApp() {
  try {
    // Connect to MongoDB
    await db.connectToDatabase();
    logger.info('MongoDB connection established');
    
    // Start the bot
    startBot();
    
    logger.info('Application successfully started');
  } catch (error) {
    logger.error('Failed to start application:', error);
    process.exit(1);
  }
}

// Handle application shutdown
process.on('SIGINT', () => {
  logger.info('Application shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Application terminating...');
  process.exit(0);
});

// Start the application
startApp().catch(err => {
  logger.error('Error starting app:', err);
  process.exit(1);
});