// src/services/confluence/index.js
const cacheManager = require('./cacheManager');
const transactionProcessor = require('./transactionProcessor');
const groupSettingsManager = require('./groupSettingsManager');
const integratedConfluenceDetector = require('./integratedConfluenceDetector');
const logger = require('../../utils/logger');
const confluenceDbService = require('../../db/services/confluenceDbService');

/**
 * Main confluence service module - optimized version
 * This version uses integrated detection with database persistence
 */
const confluenceService = {
  // Re-export the caches for backward compatibility
  transactionsCache: cacheManager.transactionsCache,
  detectedConfluences: cacheManager.detectedConfluences,
  
  /**
   * Initialize the confluence service
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      // Initialize cache services
      await cacheManager.initialize();
      
      // Initialize the integrated detector
      await integratedConfluenceDetector.initialize();
      
      logger.info('Optimized confluence service initialized');
      return true;
    } catch (error) {
      logger.error(`Error initializing confluence service: ${error.message}`);
      return false;
    }
  },
  
  /**
   * Add a transaction with duplicate checking
   * @param {Transaction} transaction - Transaction to add
   * @param {string} groupId - Group ID
   * @returns {Promise<boolean>} Success status
   */
  async addTransaction(transaction, groupId) {
    const result = await transactionProcessor.addTransaction(transaction, groupId);
    
    // If transaction was added successfully, check for confluences with context
    if (result) {
      // We don't need to await this - let it run asynchronously
      this.checkConfluencesWithContext(groupId, transaction)
        .catch(err => logger.error(`Error checking confluences after transaction: ${err.message}`));
    }
    
    return result;
  },
  
  /**
   * Check for confluences - using the optimized integrated detector
   * @param {string} groupId - Group ID
   * @returns {Promise<Array>} - List of detected confluences
   */
  async checkConfluences(groupId = 'default') {
    return integratedConfluenceDetector.checkConfluences(groupId);
  },
  
  /**
   * Check for confluences with transaction context for optimization
   * @param {string} groupId - Group ID
   * @param {Object} transaction - Current transaction being processed
   * @returns {Promise<Array>} - List of detected confluences
   */
  async checkConfluencesWithContext(groupId, transaction) {
    return integratedConfluenceDetector.checkConfluences(groupId, transaction);
  },
  
  /**
   * Clean transactions that are too old
   * @returns {Promise<void>}
   */
  async cleanOldTransactions() {
    return cacheManager.cleanOldTransactions();
  },
  
  /**
   * Estimate the used cache size
   * @returns {Promise<Object>} Cache size estimation
   */
  async estimateCacheSize() {
    return cacheManager.estimateCacheSize();
  },
  
  /**
   * Dump the entire transactions cache for debugging
   * @returns {Promise<void>}
   */
  async dumpTransactionsCache() {
    return cacheManager.dumpTransactionsCache();
  },
  
  /**
   * Find transactions for a specific token (debugging)
   * @param {string} tokenSymbolOrAddress - Symbol or address to search for
   * @returns {Promise<void>}
   */
  async findTransactionsForToken(tokenSymbolOrAddress) {
    return transactionProcessor.findTransactionsForToken(tokenSymbolOrAddress);
  },
  
  /**
   * Get minimum wallets setting for a group
   * @param {string} groupId - Group ID
   * @returns {Promise<number>} Minimum wallets setting
   */
  async getMinWalletsForGroup(groupId) {
    return groupSettingsManager.getMinWalletsForGroup(groupId);
  },
  
  /**
   * Get time window setting for a group
   * @param {string} groupId - Group ID
   * @returns {Promise<number>} Time window in minutes
   */
  async getWindowMinutesForGroup(groupId) {
    return groupSettingsManager.getWindowMinutesForGroup(groupId);
  },
  
  /**
   * Get all settings for a group
   * @param {string} groupId - Group ID
   * @returns {Promise<Object>} Group settings
   */
  async getAllGroupSettings(groupId) {
    return groupSettingsManager.getAllGroupSettings(groupId);
  },
  
  /**
   * Force synchronization between memory cache and database
   * Useful for admin operations
   * @returns {Promise<void>}
   */
  async forceSyncWithDatabase() {
    return integratedConfluenceDetector.syncCacheWithDatabase();
  },
  
  /**
   * Get statistics about stored confluences
   * @returns {Promise<Object>} Confluence statistics
   */
  async getConfluenceStats() {
    return confluenceDbService.getConfluenceStats();
  },
  
  /**
   * Update queue processor to use optimized detection
   * Call this immediately after starting the app
   */
  async setupQueueProcessor() {
    try {
      const queueManager = require('../queueService');
      
      // Modify the processTransactionForGroup method to use context-aware confluence detection
      const originalProcessTransactionForGroup = queueManager.processTransactionForGroup.bind(queueManager);
      
      queueManager.processTransactionForGroup = async function(transaction, groupId) {
        try {
          // Extract metadata if available (for confluence filtering)
          const meta = transaction._meta || {};
          delete transaction._meta; // Remove metadata before processing
          
          // Add the transaction to MongoDB via the service
          await require('../../db').storeTransaction(transaction, groupId);
          
          // This guarantees that processing happens in isolation for each group
          // Use the context-aware confluence detection to improve performance
          const allConfluences = await confluenceService.checkConfluencesWithContext(groupId, transaction);
          
          // If we have token filtering information and confluences
          if (allConfluences.length > 0 && (meta.currentToken || meta.currentTokenAddress)) {
            // Filter to only show confluences related to the current token
            const relevantConfluences = allConfluences.filter(confluence => 
              confluence.coin === meta.currentToken || 
              (meta.currentTokenAddress && confluence.coinAddress === meta.currentTokenAddress)
            );
            
            // Log the filtering
            if (allConfluences.length > relevantConfluences.length) {
              logger.debug(`Filtered ${allConfluences.length} confluences down to ${relevantConfluences.length} relevant to token ${meta.currentToken || meta.currentTokenAddress}`);
            }
            
            // If relevant confluences are detected, send alerts
            if (relevantConfluences && relevantConfluences.length > 0) {
              const telegramService = require('../telegramService'); // Require here to avoid circular dependencies
              
              for (const confluence of relevantConfluences) {
                try {
                  // Format the message
                  const message = telegramService.formatConfluenceMessage(confluence);
                  
                  // Send the alert via bot
                  await this.sendConfluenceAlert(groupId, message);
                  
                  logger.info(`Confluence alert sent for ${confluence.coin} in group ${groupId}: ${confluence.wallets.length} wallets`);
                } catch (alertError) {
                  logger.error(`Error sending confluence alert: ${alertError.message}`);
                }
              }
            }
          }
          
          return true;
        } catch (error) {
          logger.error(`Error processing transaction for group ${groupId}: ${error.message}`);
          throw error; // Rethrow to trigger retry mechanism
        }
      };
      
      logger.info('Queue processor updated to use optimized confluence detection');
    } catch (error) {
      logger.error(`Error setting up queue processor: ${error.message}`);
    }
  },
  
  /**
   * Optimize memory usage by removing old data
   * @returns {Promise<void>}
   */
  async optimizeMemoryUsage() {
    try {
      // Clean old transactions from cache
      await cacheManager.cleanOldTransactions();
      
      // Clean old data from database
      const transactionService = require('../../db/services/transactionService');
      await transactionService.cleanupOldTransactions(48);
      
      // Deactivate old confluences
      await confluenceDbService.deactivateOldConfluences(48);
      
      // Force garbage collection if Node.js allows it
      if (global.gc) {
        global.gc();
        logger.info('Forced garbage collection after optimization');
      }
      
      logger.info('Memory usage optimized');
    } catch (error) {
      logger.error(`Error optimizing memory usage: ${error.message}`);
    }
  }
};

module.exports = confluenceService;