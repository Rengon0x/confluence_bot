// src/services/confluenceService.js
const NodeCache = require('node-cache');
const config = require('../config/config');
const logger = require('../utils/logger');
const transactionService = require('../db/services/transactionService');

/**
 * Service to detect buy and sell confluences
 */
const confluenceService = {
  // Cache to store recent transactions for fast access
  transactionsCache: new NodeCache({ stdTTL: config.confluence.windowMinutes * 60 }),
  
  // Cache to store already detected confluences to avoid duplicates
  detectedConfluences: new NodeCache({ stdTTL: config.confluence.windowMinutes * 60 }),
  
  /**
   * Initialize the confluence service
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      // Load recent transactions from MongoDB
      const transactions = await transactionService.loadRecentTransactions(60);
      
      // Populate the cache
      for (const [key, txList] of Object.entries(transactions)) {
        this.transactionsCache.set(key, txList);
      }
      
      logger.info(`Confluence service initialized with ${Object.keys(transactions).length} transaction groups`);
    } catch (error) {
      logger.error(`Error initializing confluence service: ${error.message}`);
    }
  },
  
  /**
   * Add a transaction to the service
   * @param {Transaction} transaction - Transaction to add
   * @param {string} groupId - Group ID
   */
  async addTransaction(transaction, groupId = 'default') {
    try {
      const key = `${groupId}_${transaction.type}_${transaction.coin}`;
      
      // Store in MongoDB first
      await transactionService.storeTransaction(transaction, groupId);
      
      // Then update the cache
      let transactions = this.transactionsCache.get(key) || [];
      
      // Add the new transaction
      transactions.push({
        walletAddress: transaction.walletAddress,
        walletName: transaction.walletName,
        amount: transaction.amount,
        usdValue: transaction.usdValue,
        timestamp: transaction.timestamp,
        marketCap: transaction.marketCap || 0
      });
      
      // Save to cache
      this.transactionsCache.set(key, transactions);
      
      logger.debug(`Transaction added for group ${groupId}: ${transaction.type} ${transaction.amount} ${transaction.coin} by ${transaction.walletName}`);
      return true;
    } catch (error) {
      logger.error('Error adding transaction:', error);
      return false;
    }
  },
  
  /**
   * Check for confluences
   * @param {string} groupId - Group ID
   * @returns {Array} - List of detected confluences
   */
  checkConfluences(groupId = 'default') {
    try {
      const confluences = [];
      const keys = this.transactionsCache.keys();
      
      // Filter keys for this group
      const groupKeys = keys.filter(key => key.startsWith(`${groupId}_`));
      
      for (const key of groupKeys) {
        // Extract type and coin from key (format: "groupId_type_coin")
        const parts = key.split('_');
        const type = parts[1];
        const coin = parts[2];
        
        const transactions = this.transactionsCache.get(key) || [];
        
        // Group by wallet
        const walletMap = new Map();
        for (const tx of transactions) {
          if (!walletMap.has(tx.walletAddress)) {
            walletMap.set(tx.walletAddress, {
              walletAddress: tx.walletAddress,
              walletName: tx.walletName,
              amount: tx.amount,
              usdValue: tx.usdValue,
              timestamp: tx.timestamp,
              marketCap: tx.marketCap || 0
            });
          }
        }
        
        // Check if enough different wallets made a transaction
        const wallets = [...walletMap.values()];
        const minWallets = this.getMinWalletsForGroup(groupId);
        
        if (wallets.length >= minWallets) {
          // Calculate a unique key for this confluence
          const walletAddresses = wallets.map(w => w.walletAddress).sort().join('_');
          const confluenceKey = `${groupId}_${type}_${coin}_${walletAddresses}`;
          
          // Check if this confluence has already been detected recently
          if (!this.detectedConfluences.has(confluenceKey)) {
            // Mark this confluence as detected
            this.detectedConfluences.set(confluenceKey, true);
            
            // Calculate average market cap from all transactions that have it
            let totalMarketCap = 0;
            let marketCapCount = 0;
            
            wallets.forEach(wallet => {
              if (wallet.marketCap > 0) {
                totalMarketCap += wallet.marketCap;
                marketCapCount++;
              }
            });
            
            const avgMarketCap = marketCapCount > 0 ? totalMarketCap / marketCapCount : 0;
            
            // Create the confluence object
            const confluence = {
              type,
              coin,
              wallets,
              count: wallets.length,
              totalAmount: wallets.reduce((sum, w) => sum + w.amount, 0),
              totalUsdValue: wallets.reduce((sum, w) => sum + (w.usdValue || 0), 0),
              avgMarketCap,
              timestamp: new Date(),
              groupId // Add groupId for reference
            };
            
            confluences.push(confluence);
            logger.info(`Confluence detected for group ${groupId}: ${confluence.count} wallets ${type === 'buy' ? 'bought' : 'sold'} ${coin}`);
          }
        }
      }
      
      return confluences;
    } catch (error) {
      logger.error('Error checking confluences:', error);
      return [];
    }
  },
  
  /**
   * Get minimum wallets setting for a group
   * @param {string} groupId - Group ID
   * @returns {number} Minimum wallets setting
   */
  getMinWalletsForGroup(groupId) {
    // This could be extended to get group-specific settings from the database
    return config.confluence.minWallets;
  },


  /**
   * Estimate the used cache size
   */
  estimateCacheSize() {
    const keys = this.transactionsCache.keys();
    let totalEntries = 0;
    let estimatedSizeBytes = 0;
    
    for (const key of keys) {
      const transactions = this.transactionsCache.get(key) || [];
      totalEntries += transactions.length;
      
      // Estimation grossière: chaque transaction pèse environ 500 octets
      estimatedSizeBytes += transactions.length * 500;
    }
    
    const estimatedSizeMB = estimatedSizeBytes / (1024 * 1024);
    return {
      keys: keys.length,
      totalEntries,
      estimatedSizeMB
    };
  },
  
  /**
   * Clean transactions that are too old
   */
  async cleanOldTransactions() {
    try {
      const keys = this.transactionsCache.keys();
      const now = new Date();
      let totalRemoved = 0;
      let totalKept = 0;
      
      for (const key of keys) {
        let transactions = this.transactionsCache.get(key) || [];
        const originalCount = transactions.length;
        
        // Filter to keep only transactions within the time window
        transactions = transactions.filter(tx => {
          const diffMs = now - new Date(tx.timestamp);
          const diffMinutes = diffMs / 60000;
          return diffMinutes <= config.confluence.windowMinutes;
        });
        
        const removed = originalCount - transactions.length;
        totalRemoved += removed;
        totalKept += transactions.length;
        
        if (transactions.length > 0) {
          this.transactionsCache.set(key, transactions);
          if (removed > 0) {
            logger.debug(`Cleaned ${removed} old transactions for ${key}, ${transactions.length} remain`);
          }
        } else {
          this.transactionsCache.del(key);
          logger.debug(`Removed empty key ${key} from cache`);
        }
      }

      // Check the total size and clean if necessary
      const cacheStats = this.estimateCacheSize();
      
      if (cacheStats.estimatedSizeMB > 100) {
        logger.warn(`Cache size exceeds threshold (${cacheStats.estimatedSizeMB.toFixed(2)}MB), performing additional cleanup`);
        
        // Sort the tx by date
        const sortedKeys = [...keys].sort((a, b) => {
          const txA = this.transactionsCache.get(a);
          const txB = this.transactionsCache.get(b);
          
          if (!txA || txA.length === 0) return 1;
          if (!txB || txB.length === 0) return -1;
          
          const latestA = Math.max(...txA.map(tx => new Date(tx.timestamp).getTime()));
          const latestB = Math.max(...txB.map(tx => new Date(tx.timestamp).getTime()));
          
          return latestB - latestA; 
        });
        
        // Delete the 30% oldest txs
        const keysToRemove = sortedKeys.slice(Math.floor(sortedKeys.length * 0.7));
        for (const key of keysToRemove) {
          this.transactionsCache.del(key);
        }
        
        logger.info(`Emergency cleanup completed: removed ${keysToRemove.length} transaction groups`);
      }
      
      if (totalRemoved > 0) {
        logger.info(`Cleaned ${totalRemoved} old transactions, ${totalKept} remain in cache`);
      }
    } catch (error) {
      logger.error('Error cleaning old transactions:', error);
    }
  }
};

module.exports = confluenceService;