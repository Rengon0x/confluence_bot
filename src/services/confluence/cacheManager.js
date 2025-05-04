// src/services/confluence/cacheManager.js
const CacheService = require('../cacheService');
const config = require('../../config/config');
const logger = require('../../utils/logger');
const groupSettingsManager = require('./groupSettingsManager');

/**
 * Manages caching for confluence detection - optimized for performance
 */
const cacheManager = {
  // Cache to store recent transactions for fast access
  transactionsCache: new CacheService({ 
    stdTTL: config.confluence.windowMinutes * 60,
    prefix: config.redis.transactionsCachePrefix
  }),
  
  // Cache to store already detected confluences to avoid duplicates
  detectedConfluences: new CacheService({ 
    stdTTL: config.confluence.windowMinutes * 60,
    prefix: config.redis.confluencesCachePrefix
  }),
  
  // Memory cache for group settings to avoid repeated DB lookups
  groupSettingsCache: new Map(),
  groupSettingsTTL: 5 * 60 * 1000, // 5 minutes TTL for group settings
  
  /**
   * Initialize the cache manager
   * @returns {Promise<void>}
   */
  async initialize() {
    await this.transactionsCache.initialize();
    await this.detectedConfluences.initialize();
    logger.info('Confluence cache services initialized');
  },
  
  /**
   * Estimate the used cache size
   * @returns {Promise<Object>} Cache size estimation
   */
  async estimateCacheSize() {
    return this.transactionsCache.estimateSize();
  },

  /**
   * Clean transactions that are too old from cache
   * Optimized for better performance and memory usage
   * @returns {Promise<void>}
   */
  async cleanOldTransactions() {
    try {
      const keys = await this.transactionsCache.keys();
      const now = new Date();
      let totalRemoved = 0;
      let totalKept = 0;
      
      // Skip processing if no keys
      if (!keys || keys.length === 0) {
        return;
      }
      
      // Group keys by groupId for more efficient processing
      const groupKeys = {};
      for (const key of keys) {
        // Skip keys that don't match our expected format with groupId as first part
        if (!key || !key.includes('_')) continue;
        
        const groupId = key.split('_')[0]; // Extract groupId from key
        if (!groupKeys[groupId]) {
          groupKeys[groupId] = [];
        }
        groupKeys[groupId].push(key);
      }
      
      // Process each group in batches (to avoid memory spikes)
      for (const [groupId, groupKeyList] of Object.entries(groupKeys)) {
        try {
          // Get the window minutes for this specific group - use cached value if available
          const windowMinutes = await this.getGroupWindowMinutes(groupId);
          logger.debug(`Using window of ${windowMinutes} minutes for group ${groupId}`);
          
          // Calculate cutoff time based on group's window
          const cutoffTime = new Date(now.getTime() - (windowMinutes * 60 * 1000));
          
          // Process in batches to avoid memory pressure
          const BATCH_SIZE = 25;
          for (let i = 0; i < groupKeyList.length; i += BATCH_SIZE) {
            const batch = groupKeyList.slice(i, i + BATCH_SIZE);
            await this.processBatchCleanup(batch, cutoffTime, totalRemoved, totalKept);
            
            // Small delay between batches to prevent event loop blocking
            if (i + BATCH_SIZE < groupKeyList.length) {
              await new Promise(resolve => setTimeout(resolve, 5));
            }
          }
        } catch (groupError) {
          logger.error(`Error cleaning transactions for group ${groupId}: ${groupError.message}`);
        }
      }
      
      // Check the total size and clean if necessary
      const cacheStats = await this.estimateCacheSize();
      
      if (cacheStats.estimatedSizeMB > 100) {
        await this.performEmergencyCleanup(cacheStats);
      }
      
      if (totalRemoved > 0) {
        logger.info(`Cleaned ${totalRemoved} old transactions, ${totalKept} remain in cache`);
      }
    } catch (error) {
      logger.error('Error cleaning old transactions:', error);
    }
  },
  
  /**
   * Process a batch of keys for cleanup
   * @param {Array} keys - Array of cache keys to process
   * @param {Date} cutoffTime - Cutoff time for transactions
   * @param {number} totalRemoved - Running count of removed transactions
   * @param {number} totalKept - Running count of kept transactions
   * @returns {Promise<void>}
   */
  async processBatchCleanup(keys, cutoffTime, totalRemoved, totalKept) {
    const promises = [];
    
    for (const key of keys) {
      promises.push(
        (async () => {
          try {
            const transactions = await this.transactionsCache.get(key);
            
            if (!Array.isArray(transactions)) {
              logger.debug(`Skipping key ${key} as transactions is not an array`);
              return;
            }
            
            const originalCount = transactions.length;
            
            // Filter transactions based on time window - use numeric comparison for better performance
            const cutoffTimeMs = cutoffTime.getTime();
            const filteredTransactions = transactions.filter(tx => {
              try {
                const txTime = new Date(tx.timestamp).getTime();
                return txTime >= cutoffTimeMs;
              } catch (err) {
                return false; // Remove problematic transactions
              }
            });
            
            const removedCount = originalCount - filteredTransactions.length;
            totalRemoved += removedCount;
            totalKept += filteredTransactions.length;
            
            if (removedCount > 0) {
              logger.debug(`Cleaned ${removedCount} old transactions for key ${key}`);
            }
            
            // Update or delete the key
            if (filteredTransactions.length > 0) {
              await this.transactionsCache.set(key, filteredTransactions);
            } else {
              await this.transactionsCache.del(key);
              logger.debug(`Removed empty key ${key} from cache`);
            }
          } catch (err) {
            logger.error(`Error processing key ${key}: ${err.message}`);
          }
        })()
      );
    }
    
    await Promise.all(promises);
  },
  
  /**
   * Perform emergency cleanup when cache size exceeds threshold
   * @param {Object} cacheStats - Current cache statistics
   * @returns {Promise<void>}
   */
  async performEmergencyCleanup(cacheStats) {
    logger.warn(`Cache size exceeds threshold (${cacheStats.estimatedSizeMB.toFixed(2)}MB), performing additional cleanup`);
    
    // Get updated keys after regular cleanup
    const updatedKeys = await this.transactionsCache.keys();
    
    // Early exit if no keys
    if (!updatedKeys || updatedKeys.length === 0) {
      return;
    }
    
    // Fetch all key data in batches
    const keyTransactions = {};
    const BATCH_SIZE = 25;
    
    for (let i = 0; i < updatedKeys.length; i += BATCH_SIZE) {
      const batchKeys = updatedKeys.slice(i, i + BATCH_SIZE);
      const batchPromises = batchKeys.map(async (key) => {
        const transactions = await this.transactionsCache.get(key);
        if (transactions && transactions.length > 0) {
          keyTransactions[key] = transactions;
        }
      });
      
      await Promise.all(batchPromises);
      
      // Small delay between batches
      if (i + BATCH_SIZE < updatedKeys.length) {
        await new Promise(resolve => setTimeout(resolve, 5));
      }
    }
    
    // Calculate key scores for prioritization (combining recency and size)
    const keyScores = {};
    Object.entries(keyTransactions).forEach(([key, txs]) => {
      // Calculate the latest transaction time
      let latestTime = 0;
      for (const tx of txs) {
        const txTime = new Date(tx.timestamp).getTime();
        if (txTime > latestTime) {
          latestTime = txTime;
        }
      }
      
      // Calculate size score (larger = higher priority for removal)
      const sizeScore = txs.length;
      
      // Calculate recency score (older = higher priority for removal)
      const recencyScore = Date.now() - latestTime;
      
      // Combine scores - weight recency more heavily
      keyScores[key] = (sizeScore * 0.3) + (recencyScore * 0.7);
    });
    
    // Sort keys by score (highest first)
    const sortedKeys = Object.keys(keyTransactions).sort((a, b) => keyScores[b] - keyScores[a]);
    
    // Delete the 30% oldest/largest transaction groups
    const keysToRemove = sortedKeys.slice(0, Math.ceil(sortedKeys.length * 0.3));
    
    // Remove in batches
    for (let i = 0; i < keysToRemove.length; i += BATCH_SIZE) {
      const batchKeys = keysToRemove.slice(i, i + BATCH_SIZE);
      const removePromises = batchKeys.map(key => this.transactionsCache.del(key));
      
      await Promise.all(removePromises);
      
      // Small delay between batches
      if (i + BATCH_SIZE < keysToRemove.length) {
        await new Promise(resolve => setTimeout(resolve, 5));
      }
    }
    
    logger.info(`Emergency cleanup completed: removed ${keysToRemove.length} transaction groups`);
  },
  
  /**
   * Get group window minutes with caching
   * @param {string} groupId - Group ID
   * @returns {Promise<number>} - Window minutes for the group
   */
  async getGroupWindowMinutes(groupId) {
    // Check if we have cached group settings
    const now = Date.now();
    if (this.groupSettingsCache.has(groupId)) {
      const cached = this.groupSettingsCache.get(groupId);
      
      // Use cached value if not expired
      if (now - cached.timestamp < this.groupSettingsTTL) {
        return cached.windowMinutes;
      }
    }
    
    // Get fresh value from database
    const windowMinutes = await groupSettingsManager.getWindowMinutesForGroup(groupId);
    
    // Cache the result
    this.groupSettingsCache.set(groupId, {
      windowMinutes,
      timestamp: now
    });
    
    return windowMinutes;
  },
  
  /**
   * Dump the entire transactions cache for debugging
   * @returns {Promise<void>}
   */
  async dumpTransactionsCache() {
    const keys = await this.transactionsCache.keys();
    logger.debug(`--- TRANSACTION CACHE DUMP ---`);
    logger.debug(`Total keys in cache: ${keys.length}`);
    
    // Process cache dump in batches
    const BATCH_SIZE = 20;
    for (let i = 0; i < keys.length; i += BATCH_SIZE) {
      const batchKeys = keys.slice(i, i + BATCH_SIZE);
      const batchPromises = batchKeys.map(async (key) => {
        const transactions = await this.transactionsCache.get(key);
        if (!transactions) return;
        
        // Count unique wallets
        const wallets = new Set();
        for (const tx of transactions) {
          wallets.add(tx.walletName);
        }
        
        logger.debug(`Key: ${key}`);
        logger.debug(`  Transactions: ${transactions.length}`);
        logger.debug(`  Unique wallets: ${wallets.size}`);
        
        // Only show first 5 wallets to avoid excessive logging
        const walletsArray = Array.from(wallets);
        logger.debug(`  Wallets: ${walletsArray.slice(0, 5).join(', ')}${walletsArray.length > 5 ? '...' : ''}`);
      });
      
      await Promise.all(batchPromises);
      
      // Small delay between batches to prevent event loop blocking
      if (i + BATCH_SIZE < keys.length) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    
    logger.debug(`--- END TRANSACTION CACHE DUMP ---`);
  }
};

module.exports = cacheManager;