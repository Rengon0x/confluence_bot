// src/services/confluence/cacheManager.js
const CacheService = require('../cacheService');
const config = require('../../config/config');
const logger = require('../../utils/logger');
const groupSettingsManager = require('./groupSettingsManager');

/**
 * Manages caching for confluence detection
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
 * @returns {Promise<void>}
 */
async cleanOldTransactions() {
    try {
      const keys = await this.transactionsCache.keys();
      const now = new Date();
      let totalRemoved = 0;
      let totalKept = 0;
      
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
      
      const cleanupPromises = [];
      
      // Process each group separately with its own window setting
      for (const [groupId, groupKeyList] of Object.entries(groupKeys)) {
        cleanupPromises.push(
          (async () => {
            try {
              // Get the window minutes for this specific group
              const windowMinutes = await groupSettingsManager.getWindowMinutesForGroup(groupId);
              logger.debug(`Using window of ${windowMinutes} minutes for group ${groupId}`);
              
              // Calculate cutoff time based on group's window
              const cutoffTime = new Date(now.getTime() - (windowMinutes * 60 * 1000));
              
              // Process each key for this group
              for (const key of groupKeyList) {
                const transactions = await this.transactionsCache.get(key);
                
                if (!Array.isArray(transactions)) {
                  logger.debug(`Skipping key ${key} as transactions is not an array`);
                  continue; // Skip if not an array
                }
                
                const originalCount = transactions.length;
                
                // Filter transactions based on group's time window
                const filteredTransactions = transactions.filter(tx => {
                  try {
                    const txTime = new Date(tx.timestamp);
                    return txTime >= cutoffTime;
                  } catch (err) {
                    logger.warn(`Error processing transaction timestamp in key ${key}: ${err.message}`);
                    return false; // Remove problematic transactions
                  }
                });
                
                const removedCount = originalCount - filteredTransactions.length;
                totalRemoved += removedCount;
                totalKept += filteredTransactions.length;
                
                if (removedCount > 0) {
                  logger.debug(`Cleaned ${removedCount} old transactions for key ${key} (window: ${windowMinutes}m)`);
                }
                
                // Update or delete the key
                if (filteredTransactions.length > 0) {
                  await this.transactionsCache.set(key, filteredTransactions);
                } else {
                  await this.transactionsCache.del(key);
                  logger.debug(`Removed empty key ${key} from cache`);
                }
              }
            } catch (innerError) {
              logger.error(`Error cleaning transactions for group ${groupId}: ${innerError.message}`);
            }
          })()
        );
      }
      
      // Wait for all group cleanups to complete
      await Promise.all(cleanupPromises);
      
      // Check the total size and clean if necessary
      const cacheStats = await this.estimateCacheSize();
      
      if (cacheStats.estimatedSizeMB > 100) {
        logger.warn(`Cache size exceeds threshold (${cacheStats.estimatedSizeMB.toFixed(2)}MB), performing additional cleanup`);
        
        // Perform emergency cleanup as before
        const updatedKeys = await this.transactionsCache.keys();
        const keyTransactions = {};
        const fetchPromises = [];
        
        for (const key of updatedKeys) {
          fetchPromises.push(
            this.transactionsCache.get(key).then(transactions => {
              if (transactions && transactions.length > 0) {
                keyTransactions[key] = transactions;
              }
            })
          );
        }
        
        await Promise.all(fetchPromises);
        
        // Sort by recency
        const sortedKeys = Object.keys(keyTransactions).sort((a, b) => {
          const txA = keyTransactions[a];
          const txB = keyTransactions[b];
          
          if (!txA || txA.length === 0) return 1;
          if (!txB || txB.length === 0) return -1;
          
          const latestA = Math.max(...txA.map(tx => new Date(tx.timestamp).getTime()));
          const latestB = Math.max(...txB.map(tx => new Date(tx.timestamp).getTime()));
          
          return latestB - latestA; 
        });
        
        // Delete the 30% oldest transaction groups
        const keysToRemove = sortedKeys.slice(Math.floor(sortedKeys.length * 0.7));
        const removePromises = [];
        
        for (const key of keysToRemove) {
          removePromises.push(this.transactionsCache.del(key));
        }
        
        await Promise.all(removePromises);
        
        logger.info(`Emergency cleanup completed: removed ${keysToRemove.length} transaction groups`);
      }
      
      if (totalRemoved > 0) {
        logger.info(`Cleaned ${totalRemoved} old transactions, ${totalKept} remain in cache`);
      }
    } catch (error) {
      logger.error('Error cleaning old transactions:', error);
    }
  },
  
  /**
   * Dump the entire transactions cache for debugging
   * @returns {Promise<void>}
   */
  async dumpTransactionsCache() {
    const keys = await this.transactionsCache.keys();
    logger.debug(`--- TRANSACTION CACHE DUMP ---`);
    logger.debug(`Total keys in cache: ${keys.length}`);
    
    const dumpPromises = [];
    
    for (const key of keys) {
      dumpPromises.push(
        this.transactionsCache.get(key).then(transactions => {
          if (!transactions) return;
          
          logger.debug(`Key: ${key}`);
          logger.debug(`  Transactions: ${transactions.length}`);
          
          const wallets = new Set();
          for (const tx of transactions) {
            wallets.add(tx.walletName);
          }
          
          logger.debug(`  Unique wallets: ${wallets.size}`);
          logger.debug(`  Wallets: ${Array.from(wallets).join(', ')}`);
        })
      );
    }
    
    await Promise.all(dumpPromises);
    
    logger.debug(`--- END TRANSACTION CACHE DUMP ---`);
  }
};

module.exports = cacheManager;