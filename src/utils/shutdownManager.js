// src/utils/shutdownManager.js
const logger = require('./logger');

let isShuttingDown = false;
const shutdownCallbacks = [];

/**
 * Centralized shutdown manager to prevent duplicate shutdown sequences
 */
const shutdownManager = {
  /**
   * Register a callback to be executed during shutdown
   * @param {Function} callback - Function to execute during shutdown
   * @param {string} name - Name for logging purposes
   */
  registerCallback(callback, name) {
    shutdownCallbacks.push({ callback, name });
    logger.debug(`Registered shutdown callback: ${name}`);
  },

  /**
   * Execute the shutdown sequence
   * @param {string} reason - Reason for shutdown
   */
  async shutdown(reason = 'unknown') {
    if (isShuttingDown) {
      logger.debug('Shutdown already in progress, ignoring additional trigger');
      return;
    }
    
    isShuttingDown = true;
    logger.info(`Application shutting down... (Reason: ${reason})`);
    
    // Execute all registered callbacks in reverse order (last registered, first executed)
    for (let i = shutdownCallbacks.length - 1; i >= 0; i--) {
      const { callback, name } = shutdownCallbacks[i];
      try {
        logger.debug(`Executing shutdown callback: ${name}`);
        await callback();
      } catch (error) {
        logger.error(`Error during shutdown callback ${name}: ${error.message}`);
      }
    }
    
    logger.info('Shutdown complete');
    process.exit(0);
  },

  /**
   * Initialize shutdown handlers
   */
  init() {
    // Handle termination signals
    process.on('SIGINT', () => this.shutdown('SIGINT'));
    process.on('SIGTERM', () => this.shutdown('SIGTERM'));
    
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error(`Uncaught exception: ${error.message}`, error);
      this.shutdown('uncaughtException');
    });
    
    logger.info('Shutdown manager initialized');
  }
};

module.exports = shutdownManager;