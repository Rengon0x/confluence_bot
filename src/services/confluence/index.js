// src/services/confluence/index.js
const cacheManager = require('./cacheManager');
const transactionProcessor = require('./transactionProcessor');
const confluenceDetector = require('./confluenceDetector');
const groupSettingsManager = require('./groupSettingsManager');
const transactionService = require('../../db/services/transactionService');
const logger = require('../../utils/logger');

/**
 * Main confluence service module
 * Provides access to the various sub-components
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
      
      // Get group settings (using default values initially)
      await groupSettingsManager.getAllGroupSettings('default');
      
      // Load 48h of transactions from MongoDB (using the maximum possible window)
      const transactions = await transactionService.loadRecentTransactions(2880); // 48 hours
      
      // Optimize memory usage - only keep the most recent 12h in cache
      // for frequent operations, but still use all 48h for confluence detection
      const cacheWindowHours = 12;
      const cacheWindowMs = cacheWindowHours * 60 * 60 * 1000;
      const recentTimestamp = new Date(Date.now() - cacheWindowMs);
      
      // Split transactions between recent (for cache) and older (for analysis only)
      const recentTransactions = [];
      const olderTransactions = [];
      
      for (const tx of transactions) {
        if (new Date(tx.timestamp) >= recentTimestamp) {
          recentTransactions.push(tx);
        } else {
          olderTransactions.push(tx);
        }
      }
      
      logger.info(`Loaded ${transactions.length} transactions (${recentTransactions.length} recent for cache, ${olderTransactions.length} older for analysis)`);
      
      // Group recent transactions for cache storage
      const grouped = {};
      
      for (const tx of recentTransactions) {
        // Make sure type is valid
        if (!tx.type) {
          tx.type = tx.baseAmount > 0 ? 'buy' : 'sell';
          logger.debug(`Setting default type ${tx.type} for transaction from wallet ${tx.walletName}`);
        }
        
        // Determine the appropriate cache key - prioritize address over name
        let key;
        if (tx.coinAddress && tx.coinAddress.length > 0) {
          key = `${tx.groupId}_${tx.type}_addr_${tx.coinAddress}`;
        } else {
          key = `${tx.groupId}_${tx.type}_name_${tx.coin}`;
        }
        
        if (!grouped[key]) {
          grouped[key] = [];
        }
        
        // Include all important fields
        grouped[key].push({
          walletName: tx.walletName,
          walletAddress: tx.walletAddress, // Include wallet address
          coin: tx.coin,
          coinAddress: tx.coinAddress,
          amount: tx.amount,
          usdValue: tx.usdValue,
          timestamp: tx.timestamp,
          marketCap: tx.marketCap || 0,
          type: tx.type,                // Preserve transaction type
          baseAmount: tx.baseAmount || 0,  // Preserve base amount
          baseSymbol: tx.baseSymbol || ''  // Preserve base symbol
        });
      }
      
      // Populate cache with grouped transactions using batch operations
      const batchPromises = [];
      for (const [key, txList] of Object.entries(grouped)) {
        batchPromises.push(cacheManager.transactionsCache.set(key, txList));
      }
      
      // Wait for all cache operations to complete
      await Promise.all(batchPromises);
      
      // Store metadata about older transactions to support 48h confluence detection
      confluenceDetector.olderTransactionsMetadata = transactionProcessor.groupOlderTransactions(olderTransactions);
      
      logger.info(`Confluence service initialized with ${Object.keys(grouped).length} transaction groups in cache and ${Object.keys(confluenceDetector.olderTransactionsMetadata).length} older transaction groups metadata`);
    } catch (error) {
      logger.error(`Error initializing confluence service: ${error.message}`);
    }
  },
  
  // Re-export the main methods with the same interface
  
  /**
   * Add a transaction with duplicate checking
   * @param {Transaction} transaction - Transaction to add
   * @param {string} groupId - Group ID
   * @returns {Promise<boolean>} Success status
   */
  async addTransaction(transaction, groupId) {
    return transactionProcessor.addTransaction(transaction, groupId);
  },
  
  /**
   * Check for confluences
   * @param {string} groupId - Group ID
   * @returns {Promise<Array>} - List of detected confluences
   */
  async checkConfluences(groupId = 'default') {
    return confluenceDetector.checkConfluences(groupId);
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
  }
};

module.exports = confluenceService;