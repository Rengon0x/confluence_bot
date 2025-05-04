// src/services/confluence/transactionProcessor.js
const logger = require('../../utils/logger');
const transactionService = require('../../db/services/transactionService');
const cacheManager = require('./cacheManager');

/**
 * Processes transactions for confluence detection - optimized for performance
 */
const transactionProcessor = {
  /**
   * Check if a transaction is a duplicate (same wallet, same token, similar time)
   * Uses optimized algorithm for faster duplicate detection
   * @param {Array} existingTransactions - Existing transactions in the group
   * @param {Transaction} newTransaction - New transaction to check
   * @returns {boolean} - True if it's a duplicate
   */
  isDuplicateTransaction(existingTransactions, newTransaction) {
    // Early exit if no existing transactions
    if (!existingTransactions || existingTransactions.length === 0) {
      return false;
    }
    
    // Time window for considering transactions as duplicates (e.g., 30 seconds)
    const TIME_WINDOW = 30 * 1000; // 30 seconds in milliseconds
    const newTxTime = new Date(newTransaction.timestamp).getTime();
    
    // Only compare against transactions within the time window
    // This optimization can significantly reduce the number of comparisons needed
    const recentTransactions = existingTransactions.filter(tx => {
      const txTime = new Date(tx.timestamp).getTime();
      return Math.abs(txTime - newTxTime) < TIME_WINDOW;
    });
    
    // Use wallet address for comparison when available (faster than string comparison)
    const walletIdToCheck = newTransaction.walletAddress || newTransaction.walletName;
    const tokenIdToCheck = newTransaction.coinAddress || newTransaction.coin;
    
    // Check for duplicates using fast comparison algorithm
    return recentTransactions.some(existing => {
      // Check if it's from the same wallet (using address if available, otherwise name)
      const sameWallet = existing.walletAddress 
        ? existing.walletAddress === newTransaction.walletAddress
        : existing.walletName === newTransaction.walletName;
      
      if (!sameWallet) return false;
      
      // Check if it's the same token (faster check)
      const sameToken = existing.coinAddress 
        ? existing.coinAddress === newTransaction.coinAddress
        : existing.coin === newTransaction.coin;
      
      if (!sameToken) return false;
      
      // Check if it's a similar amount (allowing for small differences due to fees)
      const amountDifference = Math.abs(existing.baseAmount - newTransaction.baseAmount);
      const similarAmount = existing.baseAmount === 0 
        ? amountDifference < 0.01 
        : amountDifference / existing.baseAmount < 0.01; // Within 1%
      
      if (!similarAmount) return false;
      
      // All checks passed, it's likely a duplicate
      return true;
    });
  },
  
  /**
   * Add a transaction with duplicate checking - optimized version
   * @param {Transaction} transaction - Transaction to add
   * @param {string} groupId - Group ID
   * @returns {Promise<boolean>} Success status
   */
  async addTransaction(transaction, groupId) {
    try {
      // Check for invalid transactions - fail fast
      if (!transaction.type || !['buy', 'sell'].includes(transaction.type)) {
        logger.warn(`addTransaction: Invalid transaction type '${transaction.type}' - skipping`);
        return false;
      }
      
      // Generate cache key once - reuse it
      let key;
      const hasValidAddress = transaction.coinAddress && 
                            transaction.coinAddress.trim().length > 0 && 
                            transaction.coinAddress !== 'unknown' && 
                            transaction.coinAddress !== 'undefined';
      
      if (hasValidAddress) {
        key = `${groupId}_${transaction.type}_addr_${transaction.coinAddress}`;
      } else {
        key = `${groupId}_${transaction.type}_name_${transaction.coin}`;
      }
      
      logger.debug(`Using ${hasValidAddress ? 'address' : 'name'}-based key: ${key} for token ${transaction.coin || 'UNKNOWN'} (address: ${transaction.coinAddress || 'none'})`);
      
      // Get existing transactions once
      let transactions = await cacheManager.transactionsCache.get(key) || [];
      
      // Check for duplicates - optimized algorithm
      if (this.isDuplicateTransaction(transactions, transaction)) {
        logger.info(`Duplicate transaction detected for wallet ${transaction.walletName} - skipping`);
        return false;
      }
      
      // Store in MongoDB first - in parallel with cache operations
      const mongoPromise = transactionService.storeTransaction(transaction, groupId);
      
      // Pre-calculate metadata values
      const metadataKey = `meta_${key}`;
      const metadata = {
        lastUpdated: new Date(),
        tokenAddress: transaction.coinAddress,
        tokenSymbol: transaction.coin,
        transactionCount: transactions.length + 1
      };
      
      // Add to transaction array
      transactions.push(transaction);
      
      // Execute cache operations in parallel for better performance
      const [mongoResult] = await Promise.all([
        mongoPromise,
        cacheManager.transactionsCache.set(key, transactions),
        cacheManager.transactionsCache.set(metadataKey, metadata)
      ]);
      
      // Check MongoDB result
      if (!mongoResult) {
        logger.error(`Failed to store transaction in MongoDB for group ${groupId}`);
        return false;
      }
      
      // Log success with less verbose output for better performance
      if (transactions.length % 100 === 0) {
        logger.info(`Transaction count for key ${key} has reached ${transactions.length}`);
      } else {
        logger.info(`Transaction added for group ${groupId}: ${transaction.type} ${transaction.amount} ${transaction.coin || 'UNKNOWN'} by ${transaction.walletName}, key: ${key}`);
      }
      
      return true;
    } catch (error) {
      logger.error(`Error in transactionProcessor.addTransaction: ${error.message}`);
      return false;
    }
  },
  
  /**
   * Group older transactions for metadata tracking - optimized version
   * This helps support 48h confluence detection without keeping all data in memory
   * @param {Array} transactions - Older transactions
   * @returns {Object} Grouped metadata by token/group
   */
  groupOlderTransactions(transactions) {
    // Early exit for empty arrays
    if (!transactions || transactions.length === 0) {
      return {};
    }
    
    const metadata = {};
    
    // Create a map for faster aggregation
    const groupMap = new Map();
    
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
      
      // Create or update group entry
      if (!groupMap.has(key)) {
        groupMap.set(key, {
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
        });
      }
      
      // Update metadata stats
      const entry = groupMap.get(key);
      entry.wallets.add(tx.walletName);
      entry.count++;
      entry.totalAmount += tx.amount || 0;
      entry.totalBaseAmount += tx.baseAmount || 0;
      
      // Update timestamp range - use numeric comparison for better performance
      const txTime = new Date(tx.timestamp).getTime();
      const oldestTime = new Date(entry.oldestTimestamp).getTime();
      const newestTime = new Date(entry.newestTimestamp).getTime();
      
      if (txTime < oldestTime) {
        entry.oldestTimestamp = tx.timestamp;
      }
      if (txTime > newestTime) {
        entry.newestTimestamp = tx.timestamp;
      }
    }
    
    // Convert Map to object format for output
    groupMap.forEach((value, key) => {
      metadata[key] = {
        ...value,
        wallets: Array.from(value.wallets)
      };
    });
    
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
    
    // Optimize search by checking key patterns first
    const matchingKeys = keys.filter(key => 
      key.includes(`_addr_${tokenSymbolOrAddress}`) || 
      key.includes(`_name_${tokenSymbolOrAddress}`)
    );
    
    if (matchingKeys.length === 0) {
      logger.debug(`No transactions found for token: ${tokenSymbolOrAddress}`);
      logger.debug(`--- END TOKEN SEARCH ---`);
      return;
    }
    
    // Process matching keys
    for (const key of matchingKeys) {
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
          
          // Only log first 5 transactions to avoid excessive output
          const displayLimit = Math.min(transactions.length, 5);
          for (let i = 0; i < displayLimit; i++) {
            const tx = transactions[i];
            logger.debug(`  - Wallet: ${tx.walletName}, Amount: ${tx.amount}, Type: ${tx.type}, Base: ${tx.baseAmount} ${tx.baseSymbol}, Time: ${new Date(tx.timestamp).toISOString()}`);
          }
          
          if (transactions.length > displayLimit) {
            logger.debug(`  - ... and ${transactions.length - displayLimit} more transactions`);
          }
        })
      );
    }
    
    await Promise.all(searchPromises);
    
    if (!found) {
      logger.debug(`No transactions found for token: ${tokenSymbolOrAddress}`);
    }
    
    logger.debug(`--- END TOKEN SEARCH ---`);
  }
};

module.exports = transactionProcessor;