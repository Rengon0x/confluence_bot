const NodeCache = require('node-cache');
const config = require('../config/config');
const logger = require('../utils/logger');

/**
 * Service to detect buy and sell confluences
 */
const confluenceService = {
  // Cache to store recent transactions
  transactionsCache: new NodeCache({ stdTTL: config.confluence.windowMinutes * 60 }),
  
  // Cache to store already detected confluences to avoid duplicates
  detectedConfluences: new NodeCache({ stdTTL: config.confluence.windowMinutes * 60 }),
  
  /**
   * Add a transaction to the service
   * @param {Transaction} transaction - Transaction to add
   */
  addTransaction(transaction) {
    try {
      const key = `${transaction.type}_${transaction.coin}`;
      let transactions = this.transactionsCache.get(key) || [];
      
      // Add the new transaction
      transactions.push({
        walletAddress: transaction.walletAddress,
        walletName: transaction.walletName,
        amount: transaction.amount,
        usdValue: transaction.usdValue,
        timestamp: transaction.timestamp
      });
      
      // Save to cache
      this.transactionsCache.set(key, transactions);
      
      logger.debug(`Transaction added: ${transaction.type} ${transaction.amount} ${transaction.coin} by ${transaction.walletName}`);
    } catch (error) {
      logger.error('Error adding transaction:', error);
    }
  },
  
  /**
   * Check for confluences
   * @returns {Array} - List of detected confluences
   */
  checkConfluences() {
    try {
      const confluences = [];
      const keys = this.transactionsCache.keys();
      
      for (const key of keys) {
        const [type, coin] = key.split('_');
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
        if (wallets.length >= config.confluence.minWallets) {
          // Calculate a unique key for this confluence
          const walletAddresses = wallets.map(w => w.walletAddress).sort().join('_');
          const confluenceKey = `${type}_${coin}_${walletAddresses}`;
          
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
              timestamp: new Date()
            };
            
            confluences.push(confluence);
            logger.info(`Confluence detected: ${confluence.count} wallets ${type === 'buy' ? 'bought' : 'sold'} ${coin}`);
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
   * Clean transactions that are too old
   */
  cleanOldTransactions() {
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
      
      if (totalRemoved > 0) {
        logger.info(`Cleaned ${totalRemoved} old transactions, ${totalKept} remain in cache`);
      }
    } catch (error) {
      logger.error('Error cleaning old transactions:', error);
    }
  }
};

module.exports = confluenceService;