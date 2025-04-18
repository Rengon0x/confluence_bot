// src/services/confluenceService.js
const NodeCache = require('node-cache');
const config = require('../config/config');
const logger = require('../utils/logger');
const transactionService = require('../db/services/transactionService');

/**
 * Service to detect buy and sell confluences
 */

const startupTime = new Date();

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
      const transactions = await transactionService.loadRecentTransactions(60); // 60 minutes for cache
      
      // Group transactions and populate the cache
      const grouped = {};
      
      for (const tx of transactions) {
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
 * Add a transaction to the service - amélioration des logs
 * @param {Transaction} transaction - Transaction to add
 * @param {string} groupId - Group ID
 */
async addTransaction(transaction, groupId = 'default') {
  try {
    // Prioritize token address if available, otherwise use name
    let key;
    if (transaction.coinAddress && transaction.coinAddress.trim().length > 0) {
      key = `${groupId}_${transaction.type}_addr_${transaction.coinAddress}`;
      
      // Improved log for debugging - include both name and address
      logger.debug(`Using address-based key: ${key} for token ${transaction.coin || 'UNKNOWN'} (address: ${transaction.coinAddress})`);
    } else {
      key = `${groupId}_${transaction.type}_name_${transaction.coin}`;
      
      // Log the missing address
      logger.debug(`Using name-based key: ${key} for token ${transaction.coin} (no address available)`);
    }
    
    // Store in MongoDB first
    await transactionService.storeTransaction(transaction, groupId);
    
    // Then update the cache
    let transactions = this.transactionsCache.get(key) || [];
    
    // Add the new transaction with all required fields
    transactions.push({
      walletName: transaction.walletName,
      coin: transaction.coin,
      coinAddress: transaction.coinAddress,
      amount: transaction.amount,
      usdValue: transaction.usdValue,
      timestamp: transaction.timestamp,
      marketCap: transaction.marketCap || 0,
      baseAmount: transaction.baseAmount || 0,
      baseSymbol: transaction.baseSymbol || '',
      type: transaction.type  // Ensure we're storing the transaction type
    });
    
    // Save to cache
    this.transactionsCache.set(key, transactions);
    
    // Improved log message
    logger.info(`Transaction added for group ${groupId}: ${transaction.type} ${transaction.amount} ${transaction.coin || transaction.coinAddress} by ${transaction.walletName}, key: ${key}`);
    
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
      const detectedTokens = new Map(); // Map to track tokens by their address or name
      const keys = this.transactionsCache.keys();
      
      // Filter keys for this group
      const groupKeys = keys.filter(key => key.startsWith(`${groupId}_`));
      
      // Debug log for monitoring
      logger.debug(`Checking confluences for group ${groupId}, found ${groupKeys.length} keys`);
      
      // First pass: identify all tokens and their information
      for (const key of groupKeys) {
        // Extract info from key
        const parts = key.split('_');
        const type = parts[1]; // buy or sell
        let coin, coinAddress;
        
        if (parts[2] === 'addr') {
          coinAddress = parts[3];
          coin = ''; 
        } else if (parts[2] === 'name') {
          coin = parts[3];
          coinAddress = '';
        }
        
        const transactions = this.transactionsCache.get(key) || [];
        
        // Skip if no recent transactions
        const hasNewTransactions = transactions.some(tx => 
          new Date(tx.timestamp) > startupTime
        );

        if (!hasNewTransactions) {
          logger.debug(`Skipping key ${key} - no new transactions since bot startup`);
          continue;
        }
        
        // Get coin name from transactions if missing
        if (!coin && coinAddress && transactions.length > 0) {
          coin = transactions[0].coin;
        }
        
        // Create a unified token identifier (prefer address, fallback to name)
        const tokenId = coinAddress && coinAddress.length > 0 ? coinAddress : coin;
        
        // Store token info
        if (!detectedTokens.has(tokenId)) {
          detectedTokens.set(tokenId, {
            coin: coin,
            coinAddress: coinAddress,
            buyTransactions: [],
            sellTransactions: [],
            groupId: groupId
          });
        }
        
        // Add transactions to the appropriate array
        const tokenInfo = detectedTokens.get(tokenId);
        if (type === 'buy') {
          tokenInfo.buyTransactions.push(...transactions);
        } else if (type === 'sell') {
          tokenInfo.sellTransactions.push(...transactions);
        }
      }
      
      // Second pass: process each token
      for (const [tokenId, tokenInfo] of detectedTokens.entries()) {
        const { coin, coinAddress, buyTransactions, sellTransactions, groupId } = tokenInfo;
        
        // Combine all transactions for this token
        const allTransactions = [...buyTransactions, ...sellTransactions];
        
        if (allTransactions.length === 0) continue;
        
        // Add better logging for token identification
        logger.debug(`Processing token ${coin || 'UNKNOWN'} (address: ${coinAddress || 'none'}): ${buyTransactions.length} buy txs, ${sellTransactions.length} sell txs`);
        
        // Generate a unique key for this token's confluence
        const confluenceKey = coinAddress && coinAddress.length > 0 
          ? `${groupId}_addr_${coinAddress}` // Remove transaction type from key
          : `${groupId}_name_${coin}`;

        logger.debug(`Using confluence key: ${confluenceKey} based on ${coinAddress ? 'address' : 'name'}`);
          
        // Get existing confluence for this token
        const existingConfluence = this.detectedConfluences.get(confluenceKey) || { wallets: [] };
        
        // Process all transactions and create a wallet map
        const walletMap = new Map();
        
        // First, process existing wallets to maintain their order
        existingConfluence.wallets.forEach(wallet => {
          walletMap.set(wallet.walletName, {
            ...wallet,
            amount: 0,
            usdValue: 0,
            baseAmount: 0,
            marketCap: 0,
            buyAmount: 0,
            sellAmount: 0,
            buyBaseAmount: 0,
            sellBaseAmount: 0,
            transactions: [],
            isUpdated: false,
            type: wallet.type // Preserve original type
          });
        });
        
        // Sort all transactions by timestamp
        const sortedTransactions = [...allTransactions].sort((a, b) => 
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        );
        
        // Process all transactions
        for (const tx of sortedTransactions) {
          // Skip transactions without a valid type
          if (!tx.type) {
            logger.warn(`Transaction without type for ${tx.walletName}, skipping`);
            continue;
          }
          
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
              type: tx.type,  // Initial type
              buyAmount: tx.type === 'buy' ? tx.amount : 0,
              sellAmount: tx.type === 'sell' ? tx.amount : 0,
              buyBaseAmount: tx.type === 'buy' ? (tx.baseAmount || 0) : 0,
              sellBaseAmount: tx.type === 'sell' ? (tx.baseAmount || 0) : 0,
              transactions: [tx],
              isUpdated: existingConfluence.wallets.length > 0 // Mark as updated if it's a new wallet in an existing confluence
            });
          } else {
            // Existing wallet - update its data based on transaction type
            const wallet = walletMap.get(tx.walletName);
            
            // Always add the transaction to the wallet's transaction history
            wallet.transactions.push(tx);
            
            // Update the latest type (for update detection purposes), but preserve transaction history
            const previousType = wallet.type;
            wallet.type = tx.type;
            
            // Track buy and sell amounts separately
            if (tx.type === 'buy') {
              wallet.buyAmount = (wallet.buyAmount || 0) + tx.amount;
              wallet.buyBaseAmount = (wallet.buyBaseAmount || 0) + (tx.baseAmount || 0);
            } else if (tx.type === 'sell') {
              wallet.sellAmount = (wallet.sellAmount || 0) + tx.amount;
              wallet.sellBaseAmount = (wallet.sellBaseAmount || 0) + (tx.baseAmount || 0);
            }
            
            // Update values
            wallet.amount += tx.amount;
            wallet.usdValue += tx.usdValue || 0;
            wallet.baseAmount += tx.baseAmount || 0;
            
            // Update market cap calculation
            if (tx.marketCap > 0 && tx.baseAmount > 0) {
              const oldWeight = wallet.baseAmount - tx.baseAmount;
              const newWeight = tx.baseAmount;
              const totalWeight = wallet.baseAmount;
              
              if (totalWeight > 0) {
                wallet.marketCap = 
                  ((wallet.marketCap * oldWeight) + 
                  (tx.marketCap * newWeight)) / totalWeight;
              } else {
                wallet.marketCap = tx.marketCap;
              }
            }
            
            // Mark as updated if new transaction is of a different type or adds significant value
            const previousWallet = existingConfluence.wallets.find(w => w.walletName === wallet.walletName);
            if (previousWallet) {
              if (previousType !== wallet.type || 
                  Math.abs(previousWallet.baseAmount - wallet.baseAmount) > 0.01) {
                wallet.isUpdated = true;
              }
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
        const totalUniqueWallets = wallets.length;
        
        logger.debug(`Token ${coin || coinAddress}: ${totalUniqueWallets} unique wallets, minimum required: ${minWallets}`);
        
        if (totalUniqueWallets >= minWallets) {
          const isUpdate = existingConfluence.wallets.length > 0;
          
          // Determine the primary transaction type based on most recent activity
          // or the type with the most transactions
          const buyWallets = wallets.filter(w => w.buyBaseAmount > 0).length;
          const sellWallets = wallets.filter(w => w.sellBaseAmount > 0).length;
          const primaryType = buyWallets >= sellWallets ? 'buy' : 'sell';
          
          // Create the confluence object
          const confluence = {
            type: primaryType, // Primary type for the message emoji
            coin,
            coinAddress,
            wallets,
            count: totalUniqueWallets,
            totalAmount: wallets.reduce((sum, w) => sum + w.amount, 0),
            totalUsdValue: wallets.reduce((sum, w) => sum + (w.usdValue || 0), 0),
            totalBaseAmount: wallets.reduce((sum, w) => sum + (w.baseAmount || 0), 0),
            avgMarketCap: wallets.reduce((sum, w) => sum + (w.marketCap || 0), 0) / wallets.length,
            timestamp: new Date(),
            groupId,
            isUpdate,
            buyCount: buyWallets,
            sellCount: sellWallets
          };
          
          // Save this confluence for future reference
          this.detectedConfluences.set(confluenceKey, confluence);
          
          // Only send updates if something has changed
          if (isUpdate) {
            // Only add to results if at least one wallet was updated
            if (wallets.some(w => w.isUpdated)) {
              confluences.push(confluence);
              logger.info(`Unified confluence update detected for ${coin || 'UNKNOWN'} (address: ${coinAddress || 'none'}): ${totalUniqueWallets} wallets (${buyWallets} buy, ${sellWallets} sell)`);
            }
          } else {
            // New confluence
            confluences.push(confluence);
            logger.info(`Unified confluence detected for ${coin || 'UNKNOWN'} (address: ${coinAddress || 'none'}): ${totalUniqueWallets} wallets (${buyWallets} buy, ${sellWallets} sell)`);
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
      
      // Rough estimation: each transaction is approximately 500 bytes
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
   * Amélioration de la fonction findTransactionsForToken pour inclure plus d'informations sur l'adresse
   */
  findTransactionsForToken(tokenSymbolOrAddress) {
    const keys = this.transactionsCache.keys();
    logger.debug(`--- LOOKING FOR TOKEN: ${tokenSymbolOrAddress} ---`);
    
    let found = false;
    
    for (const key of keys) {
      // Check both address-based and name-based keys
      if (key.includes(`_addr_${tokenSymbolOrAddress}`) || 
          key.includes(`_name_${tokenSymbolOrAddress}`)) {
        
        found = true;
        const transactions = this.transactionsCache.get(key) || [];
        logger.debug(`Found in key: ${key}`);
        logger.debug(`  Transactions: ${transactions.length}`);
        
        // Add details about the first transaction to see full token info
        if (transactions.length > 0) {
          const firstTx = transactions[0];
          logger.debug(`  Token details: Name=${firstTx.coin || 'UNKNOWN'}, Address=${firstTx.coinAddress || 'none'}`);
        }
        
        for (const tx of transactions) {
          logger.debug(`  - Wallet: ${tx.walletName}, Amount: ${tx.amount}, Type: ${tx.type}, Base: ${tx.baseAmount} ${tx.baseSymbol}, Time: ${new Date(tx.timestamp).toISOString()}`);
        }
      }
    }
    
    if (!found) {
      logger.debug(`No transactions found for token: ${tokenSymbolOrAddress}`);
    }
    
    logger.debug(`--- END TOKEN SEARCH ---`);
  },

  /**
   * Dump the entire transactions cache for debugging
   */
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
        
        // Sort the keys by date
        const sortedKeys = [...keys].sort((a, b) => {
          const txA = this.transactionsCache.get(a);
          const txB = this.transactionsCache.get(b);
          
          if (!txA || txA.length === 0) return 1;
          if (!txB || txB.length === 0) return -1;
          
          const latestA = Math.max(...txA.map(tx => new Date(tx.timestamp).getTime()));
          const latestB = Math.max(...txB.map(tx => new Date(tx.timestamp).getTime()));
          
          return latestB - latestA; 
        });
        
        // Delete the 30% oldest transaction groups
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