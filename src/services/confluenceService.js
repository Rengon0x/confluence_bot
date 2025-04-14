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
      const transactions = await transactionService.loadRecentTransactions(60); // 60 minutes pour le cache
      
      // Group transactions and populate the cache
      const grouped = {};
      
      for (const tx of transactions) {
        // Déterminer la clé de cache appropriée
        let key;
        if (tx.coinAddress && tx.coinAddress.length > 0) {
          key = `${tx.groupId}_${tx.type}_addr_${tx.coinAddress}`;
        } else {
          key = `${tx.groupId}_${tx.type}_name_${tx.coin}`;
        }
        
        if (!grouped[key]) {
          grouped[key] = [];
        }
        
        grouped[key].push({
          walletName: tx.walletName,
          coin: tx.coin,
          coinAddress: tx.coinAddress,
          amount: tx.amount,
          usdValue: tx.usdValue,
          timestamp: tx.timestamp,
          marketCap: tx.marketCap || 0
        });
      }
      
      // Populate cache with grouped transactions
      for (const [key, txList] of Object.entries(grouped)) {
        this.transactionsCache.set(key, txList);
      }
      
      logger.info(`Confluence service initialized with ${Object.keys(grouped).length} transaction groups from ${transactions.length} transactions`);
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
      // Créer une clé composite basée sur le groupe, le type et soit l'adresse du token, soit son nom
      let key;
      if (transaction.coinAddress && transaction.coinAddress.length > 0) {
        key = `${groupId}_${transaction.type}_addr_${transaction.coinAddress}`;
      } else {
        key = `${groupId}_${transaction.type}_name_${transaction.coin}`;
      }
      
      // Store in MongoDB first
      await transactionService.storeTransaction(transaction, groupId);
      
      // Then update the cache
      let transactions = this.transactionsCache.get(key) || [];
      
      // Add the new transaction
      transactions.push({
        walletName: transaction.walletName,
        coin: transaction.coin,
        coinAddress: transaction.coinAddress,
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
        // Extract info from key
        const parts = key.split('_');
        const type = parts[1]; // buy ou sell
        let coin, coinAddress;
        
        if (parts[2] === 'addr') {
          coinAddress = parts[3];
          coin = ''; 
        } else if (parts[2] === 'name') {
          coin = parts[3];
          coinAddress = '';
        }
        
        const transactions = this.transactionsCache.get(key) || [];
        
        if (!coin && coinAddress && transactions.length > 0) {
          coin = transactions[0].coin;
        }
        
        // Get existing confluence if any
        const confluenceKey = `${groupId}_${type}_${coinAddress || coin}`;
        const existingConfluence = this.detectedConfluences.get(confluenceKey) || { wallets: [] };
        
        // Group transactions by wallet
        const walletMap = new Map();
        
        // First, process existing wallets to maintain their order
        existingConfluence.wallets.forEach(wallet => {
          walletMap.set(wallet.walletName, {
            ...wallet,
            amount: 0,
            usdValue: 0,
            baseAmount: 0,
            marketCap: 0,
            transactions: [],
            isUpdated: false,
            type: wallet.type // Preserve original type
          });
        });
        
        // Sort transactions by timestamp to process them in order
        const sortedTransactions = [...transactions].sort((a, b) => 
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
        
        // Process all transactions
        for (const tx of sortedTransactions) {
          if (!walletMap.has(tx.walletName)) {
            // New wallet - not seen before
            walletMap.set(tx.walletName, {
              walletName: tx.walletName,
              amount: tx.amount,
              usdValue: tx.usdValue || 0,
              timestamp: tx.timestamp,
              marketCap: tx.marketCap || 0,
              baseAmount: tx.baseAmount || 0,
              baseSymbol: tx.baseSymbol || '',
              type: tx.type,
              transactions: [tx],
              isUpdated: existingConfluence.wallets.length > 0 // Mark as updated if it's a new wallet in an existing confluence
            });
          } else {
            // Existing wallet - update its data
            const wallet = walletMap.get(tx.walletName);
            wallet.transactions.push(tx);
            
            // Accumulate values
            wallet.amount += tx.amount;
            wallet.usdValue += tx.usdValue || 0;
            wallet.baseAmount += tx.baseAmount || 0;
            
            // Calculate weighted average market cap based on baseAmount
            if (tx.marketCap > 0 && tx.baseAmount > 0) {
              wallet.marketCap = 
                ((wallet.marketCap * (wallet.baseAmount - tx.baseAmount)) + 
                 (tx.marketCap * tx.baseAmount)) / wallet.baseAmount;
            }
            
            // Update the transaction type to the latest
            wallet.type = tx.type;
            
            // Mark as updated if the type changed or new transactions added
            const previousWallet = existingConfluence.wallets.find(w => w.walletName === wallet.walletName);
            if (previousWallet && (previousWallet.type !== wallet.type || 
                previousWallet.baseAmount !== wallet.baseAmount)) {
              wallet.isUpdated = true;
            }
          }
        }
        
        // Convert the wallet map to an array, preserving order of appearance
        let wallets = [];
        
        // First add existing wallets in their original order
        existingConfluence.wallets.forEach(existingWallet => {
          const updatedWallet = walletMap.get(existingWallet.walletName);
          if (updatedWallet && updatedWallet.transactions.length > 0) {
            wallets.push(updatedWallet);
          }
        });
        
        // Then add new wallets in order of their first transaction
        const newWalletNames = [...walletMap.keys()].filter(
          name => !existingConfluence.wallets.some(w => w.walletName === name)
        );
        
        const newWallets = newWalletNames.map(name => walletMap.get(name))
          .filter(wallet => wallet.transactions.length > 0)
          .sort((a, b) => {
            const aFirstTx = a.transactions.reduce((earliest, tx) => 
              new Date(tx.timestamp) < new Date(earliest.timestamp) ? tx : earliest, a.transactions[0]);
            const bFirstTx = b.transactions.reduce((earliest, tx) => 
              new Date(tx.timestamp) < new Date(earliest.timestamp) ? tx : earliest, b.transactions[0]);
            return new Date(aFirstTx.timestamp).getTime() - new Date(bFirstTx.timestamp).getTime();
          });
        
        wallets = [...wallets, ...newWallets];
        
        // Check if enough different wallets made a transaction
        const minWallets = this.getMinWalletsForGroup(groupId);
        
        if (wallets.length >= minWallets) {
          const isUpdate = existingConfluence.wallets.length > 0;
          
          // Create the confluence object
          const confluence = {
            type,
            coin,
            coinAddress,
            wallets,
            count: wallets.length,
            totalAmount: wallets.reduce((sum, w) => sum + w.amount, 0),
            totalUsdValue: wallets.reduce((sum, w) => sum + (w.usdValue || 0), 0),
            totalBaseAmount: wallets.reduce((sum, w) => sum + (w.baseAmount || 0), 0),
            avgMarketCap: wallets.reduce((sum, w) => sum + w.marketCap, 0) / wallets.length,
            timestamp: new Date(),
            groupId,
            isUpdate
          };
          
          // Save this confluence for future reference
          this.detectedConfluences.set(confluenceKey, confluence);
          
          // Only send updates if something has changed
          if (isUpdate) {
            // Only add to results if at least one wallet was updated
            if (wallets.some(w => w.isUpdated)) {
              confluences.push(confluence);
              logger.info(`Confluence update detected for group ${groupId}: ${confluence.count} wallets for ${coin} (${coinAddress || 'no address'})`);
            }
          } else {
            // New confluence
            confluences.push(confluence);
            logger.info(`New confluence detected for group ${groupId}: ${confluence.count} wallets ${type === 'buy' ? 'bought' : 'sold'} ${coin} (${coinAddress || 'no address'})`);
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

  // verify txs
  findTransactionsForToken(tokenSymbolOrAddress) {
    const keys = this.transactionsCache.keys();
    logger.debug(`--- LOOKING FOR TOKEN: ${tokenSymbolOrAddress} ---`);
    
    let found = false;
    
    for (const key of keys) {
      if (key.includes(tokenSymbolOrAddress)) {
        found = true;
        const transactions = this.transactionsCache.get(key) || [];
        logger.debug(`Found in key: ${key}`);
        logger.debug(`  Transactions: ${transactions.length}`);
        
        for (const tx of transactions) {
          logger.debug(`  - Wallet: ${tx.walletName}, Amount: ${tx.amount}, Time: ${new Date(tx.timestamp).toISOString()}`);
        }
      }
    }
    
    if (!found) {
      logger.debug(`No transactions found for token: ${tokenSymbolOrAddress}`);
    }
    
    logger.debug(`--- END TOKEN SEARCH ---`);
  },

  dumpTransactionsCache() {
    const keys = this.transactionsCache.keys();
    logger.debug(`--- TRANSACTION CACHE DUMP ---`);
    logger.debug(`Total keys in cache: ${keys.length}`);
    
    for (const key of keys) {
      const transactions = this.transactionsCache.get(key) || [];
      logger.debug(`Key: ${key}`);
      logger.debug(`  Transactions: ${transactions.length}`);
      
      const wallets = new Set();
      for (const tx of transactions) {
        wallets.add(tx.walletName);
      }
      
      logger.debug(`  Unique wallets: ${wallets.size}`);
      logger.debug(`  Wallets: ${Array.from(wallets).join(', ')}`);
    }
    
    logger.debug(`--- END TRANSACTION CACHE DUMP ---`);
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