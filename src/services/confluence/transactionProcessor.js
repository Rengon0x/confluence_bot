// src/services/confluence/transactionProcessor.js
const logger = require('../../utils/logger');
const transactionService = require('../../db/services/transactionService');
const cacheManager = require('./cacheManager');

/**
 * Processes transactions for confluence detection
 */
const transactionProcessor = {
  /**
   * Check if a transaction is a duplicate (same wallet, same token, similar time)
   * @param {Array} existingTransactions - Existing transactions in the group
   * @param {Transaction} newTransaction - New transaction to check
   * @returns {boolean} - True if it's a duplicate
   */
  isDuplicateTransaction(existingTransactions, newTransaction) {
    // Time window for considering transactions as duplicates (e.g., 30 seconds)
    const TIME_WINDOW = 30 * 1000; // 30 seconds in milliseconds
    
    return existingTransactions.some(existing => {
      // Check if it's from the same wallet (using address if available, otherwise name)
      const sameWallet = (existing.walletAddress && newTransaction.walletAddress) 
        ? existing.walletAddress === newTransaction.walletAddress
        : existing.walletName === newTransaction.walletName;
      
      // Check if it's the same token
      const sameToken = existing.coinAddress === newTransaction.coinAddress || 
                       existing.coin === newTransaction.coin;
      
      // Check if it's a similar amount (allowing for small differences due to fees)
      const amountDifference = Math.abs(existing.baseAmount - newTransaction.baseAmount);
      const similarAmount = existing.baseAmount === 0 
        ? amountDifference < 0.01 
        : amountDifference / existing.baseAmount < 0.01; // Within 1%
      
      // Check if it's within the time window
      const timeDifference = Math.abs(new Date(existing.timestamp) - new Date(newTransaction.timestamp));
      const withinTimeWindow = timeDifference < TIME_WINDOW;
      
      return sameWallet && sameToken && similarAmount && withinTimeWindow;
    });
  },
  
  /**
   * Add a transaction with duplicate checking
   * @param {Transaction} transaction - Transaction to add
   * @param {string} groupId - Group ID
   * @returns {Promise<boolean>} Success status
   */
  async addTransaction(transaction, groupId) {
    try {
      // Check for invalid transactions
      if (!transaction.type || !['buy', 'sell'].includes(transaction.type)) {
        logger.warn(`addTransaction: Invalid transaction type '${transaction.type}' - skipping`);
        return false;
      }
      
      // Generate cache key
      let key;
      if (transaction.coinAddress && transaction.coinAddress.trim().length > 0 
          && transaction.coinAddress !== 'unknown' 
          && transaction.coinAddress !== 'undefined') {
        key = `${groupId}_${transaction.type}_addr_${transaction.coinAddress}`;
      } else {
        key = `${groupId}_${transaction.type}_name_${transaction.coin}`;
      }
      
      logger.debug(`Using ${transaction.coinAddress ? 'address' : 'name'}-based key: ${key} for token ${transaction.coin || 'UNKNOWN'} (address: ${transaction.coinAddress || 'none'})`);
      
      // Get existing transactions
      let transactions = await cacheManager.transactionsCache.get(key) || [];
      
      // Check for duplicates
      if (this.isDuplicateTransaction(transactions, transaction)) {
        logger.info(`Duplicate transaction detected for wallet ${transaction.walletName} - skipping`);
        return false;
      }
      
      // Store in MongoDB first
      const mongoResult = await transactionService.storeTransaction(transaction, groupId);
      if (!mongoResult) {
        logger.error(`Failed to store transaction in MongoDB for group ${groupId}`);
        return false;
      }
      
      // Add to transaction array
      transactions.push(transaction);
      
      // Store in cache
      await cacheManager.transactionsCache.set(key, transactions);
      
      // Keep metadata synchronized
      const metadataKey = `meta_${key}`;
      let metadata = await cacheManager.transactionsCache.get(metadataKey) || {};
      metadata.lastUpdated = new Date();
      metadata.tokenAddress = transaction.coinAddress;
      metadata.tokenSymbol = transaction.coin;
      metadata.transactionCount = transactions.length;
      
      await cacheManager.transactionsCache.set(metadataKey, metadata);
      
      logger.info(`Transaction added for group ${groupId}: ${transaction.type} ${transaction.amount} ${transaction.coin || 'UNKNOWN'} by ${transaction.walletName}, key: ${key}`);
      return true;
    } catch (error) {
      logger.error(`Error in transactionProcessor.addTransaction: ${error.message}`);
      return false;
    }
  },
  
  /**
   * Group older transactions for metadata tracking
   * This helps support 48h confluence detection without keeping all data in memory
   * @param {Array} transactions - Older transactions
   * @returns {Object} Grouped metadata by token/group
   */
  groupOlderTransactions(transactions) {
    const metadata = {};
    
    for (const tx of transactions) {
      // Make sure type is valid
      if (!tx.type) {
        tx.type = tx.baseAmount > 0 ? 'buy' : 'sell';
      }
      
      // Determine key (same pattern as cache keys)
      let key;
      if (tx.coinAddress && tx.coinAddress.length > 0) {
        key = `${tx.groupId}_${tx.type}_addr_${tx.coinAddress}`;
      } else {
        key = `${tx.groupId}_${tx.type}_name_${tx.coin}`;
      }
      
      if (!metadata[key]) {
        metadata[key] = {
          groupId: tx.groupId,
          type: tx.type,
          coin: tx.coin,
          coinAddress: tx.coinAddress,
          wallets: new Set(),
          oldestTimestamp: tx.timestamp,
          newestTimestamp: tx.timestamp,
          count: 0,
          totalAmount: 0,
          totalBaseAmount: 0
        };
      }
      
      // Update metadata stats
      const entry = metadata[key];
      entry.wallets.add(tx.walletName);
      entry.count++;
      entry.totalAmount += tx.amount || 0;
      entry.totalBaseAmount += tx.baseAmount || 0;
      
      // Update timestamp range
      if (new Date(tx.timestamp) < new Date(entry.oldestTimestamp)) {
        entry.oldestTimestamp = tx.timestamp;
      }
      if (new Date(tx.timestamp) > new Date(entry.newestTimestamp)) {
        entry.newestTimestamp = tx.timestamp;
      }
    }
    
    // Convert Sets to arrays for easier handling
    for (const key in metadata) {
      metadata[key].wallets = Array.from(metadata[key].wallets);
    }
    
    return metadata;
  },
  
  /**
   * Find transactions for a specific token (debugging)
   * @param {string} tokenSymbolOrAddress - Symbol or address to search for
   * @returns {Promise<void>}
   */
  async findTransactionsForToken(tokenSymbolOrAddress) {
    const keys = await cacheManager.transactionsCache.keys();
    logger.debug(`--- LOOKING FOR TOKEN: ${tokenSymbolOrAddress} ---`);
    
    let found = false;
    const searchPromises = [];
    
    for (const key of keys) {
      // Check both address-based and name-based keys
      if (key.includes(`_addr_${tokenSymbolOrAddress}`) || 
          key.includes(`_name_${tokenSymbolOrAddress}`)) {
        
        searchPromises.push(
          cacheManager.transactionsCache.get(key).then(transactions => {
            if (!transactions) return;
            
            found = true;
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
          })
        );
      }
    }
    
    await Promise.all(searchPromises);
    
    if (!found) {
      logger.debug(`No transactions found for token: ${tokenSymbolOrAddress}`);
    }
    
    logger.debug(`--- END TOKEN SEARCH ---`);
  }
};

module.exports = transactionProcessor;