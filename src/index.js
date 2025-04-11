require('dotenv').config();
const logger = require('./utils/logger');
const db = require('./db');
const { startBot } = require('./bot');
const { startForwarder } = require('./forwarder');

/**
 * Main application entry point
 */
async function startApp() {
  try {
    // Connect to MongoDB
    await db.connectToDatabase();
    logger.info('MongoDB connection established');

    // Initialize the confluence service
    await confluenceService.initialize();
    logger.info('Confluence service initialized');
    
    // Start the bot
    const bot = startBot();
    logger.info('Bot started successfully');
    
    // Start the forwarder
    const forwarder = await startForwarder();
    logger.info('Forwarder started successfully');

    // Setup periodic cleanup for transactions
    setInterval(async () => {
      await transactionService.cleanupOldTransactions(48);
    }, 3600000); // Check every hour
    
    logger.info('Application successfully started');
    
    // Handle cleanup
    process.on('SIGINT', async () => {
      logger.info('Application shutting down...');
      if (forwarder && forwarder.stop) {
        await forwarder.stop();
      }
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      logger.info('Application terminating...');
      if (forwarder && forwarder.stop) {
        await forwarder.stop();
      }
      process.exit(0);
    });
    
  } catch (error) {
    logger.error('Failed to start application:', error);
    process.exit(1);
  }
}

// Start the application
startApp().catch(err => {
  logger.error('Error starting app:', err);
  process.exit(1);
});