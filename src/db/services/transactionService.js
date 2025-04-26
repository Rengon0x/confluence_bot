// src/db/services/transactionService.js
const { getDatabase } = require('../connection');
const TransactionModel = require('../models/transaction');
const logger = require('../../utils/logger');
const performanceMonitor = require('../../utils/performanceMonitor');

/**
 * Service for handling transaction-related database operations
 */
const transactionService = {
  /**
   * Get the transactions collection
   * @returns {Promise<Collection>} The transactions collection
   */
  async getCollection() {
    const db = await getDatabase();
    return db.collection(TransactionModel.collectionName);
  },

/**
 * Store a transaction in the database
 * @param {Object} transaction - The transaction to store
 * @param {string} groupId - The group ID this transaction belongs to
 * @returns {Promise<Object>} The stored transaction
 */
async storeTransaction(transaction, groupId) {
    try {
      const collection = await this.getCollection();
      
      const transactionDoc = {
        walletName: transaction.walletName,
        type: transaction.type,
        coin: transaction.coin,
        coinAddress: transaction.coinAddress || '',
        amount: transaction.amount,
        usdValue: transaction.usdValue || 0,
        marketCap: transaction.marketCap || 0,
        timestamp: transaction.timestamp || new Date(),
        groupId: groupId,
        baseAmount: transaction.baseAmount || 0,  // Make sure we store baseAmount
        baseSymbol: transaction.baseSymbol || ''  // Make sure we store baseSymbol
      };
      
      const result = await collection.insertOne(transactionDoc);
      logger.debug(`Transaction stored in MongoDB: ${transaction.type} ${transaction.coin} by ${transaction.walletName}, base amount: ${transaction.baseAmount} ${transaction.baseSymbol}`);
      
      return { ...transactionDoc, _id: result.insertedId };
    } catch (error) {
      logger.error(`Error in transactionService.storeTransaction: ${error.message}`);
      throw error;
    }
  },

    /**
   * Delete all transactions associated with a tracker in a specific group
   * @param {string} trackerName - The tracker name
   * @param {string} groupId - The group ID
   * @returns {Promise<number>} Number of transactions deleted
   */
    async deleteTrackerTransactions(trackerName, groupId) {
      try {
        const collection = await this.getCollection();
        
        // Delete all transactions from this tracker in this group
        const result = await collection.deleteMany({
          groupId: groupId,
          walletName: { $regex: new RegExp(`^${trackerName}`, 'i') }
        });
        
        logger.info(`Deleted ${result.deletedCount} transactions for tracker ${trackerName} in group ${groupId}`);
        return result.deletedCount;
      } catch (error) {
        logger.error(`Error in transactionService.deleteTrackerTransactions: ${error.message}`);
        return 0;
      }
    },

    /**
   * Delete all transactions for a specific group
   * @param {string} groupId - The group ID
   * @returns {Promise<number>} Number of transactions deleted
   */
    async deleteGroupTransactions(groupId) {
      try {
        const collection = await this.getCollection();
        
        const result = await collection.deleteMany({ groupId: groupId });
        
        logger.info(`Deleted ${result.deletedCount} transactions for group ${groupId}`);
        return result.deletedCount;
      } catch (error) {
        logger.error(`Error in transactionService.deleteGroupTransactions: ${error.message}`);
        return 0;
      }
    },
  

  /**
   * Get recent transactions for a specific group, type, and coin
   * @param {string} groupId - The group ID
   * @param {string} type - Transaction type (buy/sell)
   * @param {string} coin - Coin symbol
   * @param {number} windowMinutes - How far back to look in minutes
   * @returns {Promise<Array>} Recent transactions
   */
  
async getRecentTransactions(groupId, type, coin, coinAddress, windowMinutes = 60) {
    try {
      const collection = await this.getCollection();
      
      const cutoffTime = new Date(Date.now() - (windowMinutes * 60 * 1000));
      
      const query = {
        groupId: groupId,
        type: type,
        timestamp: { $gte: cutoffTime }
      };
      
      let indexHint = 'group_type_time_lookup'; // Use the optimized index by default
      
      if (coinAddress && coinAddress.length > 0) {
        query.coinAddress = coinAddress;
        indexHint = 'group_type_coinaddress_lookup'; // Use the coinAddress index
      } else if (coin) {
        query.coin = coin;
        indexHint = 'group_type_coin_lookup'; // Use the coin index
      }
      
      // Using appropriate index and sorting for better performance
      const transactions = await collection.find(query)
      .sort({ timestamp: -1 })
      .toArray();
      
      return transactions;
    } catch (error) {
      logger.error(`Error in transactionService.getRecentTransactions: ${error.message}`);
      
      // Fallback if index hint fails
      if (error.message.includes('hint')) {
        try {
          logger.warn('Retrying getRecentTransactions without index hint');
          const collection = await this.getCollection();
          
          const cutoffTime = new Date(Date.now() - (windowMinutes * 60 * 1000));
          
          const query = {
            groupId: groupId,
            type: type,
            timestamp: { $gte: cutoffTime }
          };
          
          if (coinAddress && coinAddress.length > 0) {
            query.coinAddress = coinAddress;
          } else if (coin) {
            query.coin = coin;
          }
          
          return await collection.find(query).sort({ timestamp: -1 }).toArray();
        } catch (fallbackError) {
          logger.error(`Fallback error in getRecentTransactions: ${fallbackError.message}`);
          return [];
        }
      }
      
      return [];
    }
  },
  
  /**
   * Get all recent transactions by coin address for all transaction types
   * @param {string} groupId - Group ID
   * @param {string} coinAddress - Coin address
   * @param {number} windowMinutes - Time window in minutes
   * @returns {Promise<Array>} - Transactions
   */
  async getRecentTransactionsByAddress(groupId, coinAddress, windowMinutes = 2880) {
    try {
      const collection = await this.getCollection();
      
      const cutoffTime = new Date(Date.now() - (windowMinutes * 60 * 1000));
      
      const query = {
        groupId: groupId,
        coinAddress: coinAddress,
        timestamp: { $gte: cutoffTime }
      };
      
      // Use the simple coinAddress index or let MongoDB choose
      const transactions = await collection.find(query)
        .sort({ timestamp: -1 })
        .toArray();
      
      return transactions;
    } catch (error) {
      logger.error(`Error in getRecentTransactionsByAddress: ${error.message}`);
      
      // Fallback error handling
      try {
        const collection = await this.getCollection();
        const cutoffTime = new Date(Date.now() - (windowMinutes * 60 * 1000));
        
        const query = {
          groupId: groupId,
          coinAddress: coinAddress,
          timestamp: { $gte: cutoffTime }
        };
        
        return await collection.find(query).sort({ timestamp: -1 }).toArray();
      } catch (fallbackError) {
        logger.error(`Fallback error in getRecentTransactionsByAddress: ${fallbackError.message}`);
        return [];
      }
    }
  },
  
  /**
   * Get all recent transactions by coin name for all transaction types
   * @param {string} groupId - Group ID
   * @param {string} coin - Coin name
   * @param {number} windowMinutes - Time window in minutes
   * @returns {Promise<Array>} - Transactions
   */
  async getRecentTransactionsByCoin(groupId, coin, windowMinutes = 2880) {
    try {
      const collection = await this.getCollection();
      
      const cutoffTime = new Date(Date.now() - (windowMinutes * 60 * 1000));
      
      const query = {
        groupId: groupId,
        coin: coin,
        timestamp: { $gte: cutoffTime }
      };
      
      // Let MongoDB choose the best index
      const transactions = await collection.find(query)
        .sort({ timestamp: -1 })
        .toArray();
      
      return transactions;
    } catch (error) {
      logger.error(`Error in getRecentTransactionsByCoin: ${error.message}`);
      return [];
    }
  },

 /**
 * Load recent transactions for all groups
 * @param {number} windowMinutes - How far back to look in minutes
 * @returns {Promise<Object>} Map of transactions by key (groupId_type_coin)
 */
 async loadRecentTransactions(windowMinutes = 60) {
    // Start measuring database performance
    const dbTimer = performanceMonitor.startTimer();
    const operationName = `load_transactions_${windowMinutes}min`;
    
    try {
      const collection = await this.getCollection();
      
      const cutoffTime = new Date(Date.now() - (windowMinutes * 60 * 1000));
      
      const transactions = await collection.find({
        timestamp: { $gte: cutoffTime }
      })
      .sort({ groupId: 1, timestamp: -1 })
      .toArray();
      
      // Measure query performance
      const queryTime = performanceMonitor.endTimer(dbTimer, 'mongoQueries', operationName);
      logger.info(`Loaded ${transactions.length} recent transactions from MongoDB (window: ${windowMinutes} min) in ${queryTime.toFixed(2)}ms`);
      
      // Start measuring processing performance
      const processTimer = performanceMonitor.startTimer();
      
      // Process transactions in batches to improve performance with large datasets
      const batchSize = 1000;
      const batches = [];
      
      for (let i = 0; i < transactions.length; i += batchSize) {
        batches.push(transactions.slice(i, i + batchSize));
      }
      
      // Process each batch
      for (const batch of batches) {
        batch.forEach(tx => {
          // Ensure type is properly set
          if (!tx.type) {
            // If type is missing, try to infer it based on baseAmount
            tx.type = tx.baseAmount > 0 ? 'buy' : 'sell';
            logger.debug(`Inferred type '${tx.type}' for transaction by ${tx.walletName} for ${tx.coin}`);
          }
          
          // Ensure baseAmount is set
          if (tx.baseAmount === undefined) {
            tx.baseAmount = 0;
          }
          
          // Ensure baseSymbol is set
          if (!tx.baseSymbol) {
            tx.baseSymbol = 'SOL';
          }
          
          // Ensure marketCap is set
          if (tx.marketCap === undefined) {
            tx.marketCap = 0;
          }
        });
      }
      
      // Measure processing performance
      performanceMonitor.endTimer(processTimer, 'transactionProcessing', `process_transactions_${windowMinutes}min`);
      
      return transactions;
    } catch (error) {
      logger.error(`Error in transactionService.loadRecentTransactions: ${error.message}`);
      
      // Record failure in performance monitor
      performanceMonitor.endTimer(dbTimer, 'mongoQueries', `${operationName}_error`);
      
      // If index hint failed, retry without hint
      if (error.message.includes('hint')) {
        try {
          logger.warn('Retrying without index hint - this may be slower');
          const fallbackTimer = performanceMonitor.startTimer();
          
          const collection = await this.getCollection();
          const cutoffTime = new Date(Date.now() - (windowMinutes * 60 * 1000));
          
          const transactions = await collection.find({
            timestamp: { $gte: cutoffTime }
          }).toArray();
          
          // Measure fallback query performance
          const fallbackQueryTime = performanceMonitor.endTimer(fallbackTimer, 'mongoQueries', `${operationName}_fallback`);
          logger.warn(`Fallback query completed in ${fallbackQueryTime.toFixed(2)}ms`);
          
          // Process transactions
          transactions.forEach(tx => {
            if (!tx.type) tx.type = tx.baseAmount > 0 ? 'buy' : 'sell';
            if (tx.baseAmount === undefined) tx.baseAmount = 0;
            if (!tx.baseSymbol) tx.baseSymbol = 'SOL';
            if (tx.marketCap === undefined) tx.marketCap = 0;
          });
          
          return transactions;
        } catch (fallbackError) {
          logger.error(`Fallback error in loadRecentTransactions: ${fallbackError.message}`);
          return [];
        }
      }
      return [];
    }
  },


  /**
   * Get collection size
   */
  async getCollectionSize() {
    try {
      const db = await getDatabase();
      const stats = await db.command({ collStats: TransactionModel.collectionName });
      
      return {
        count: stats.count,
        sizeBytes: stats.size,
        sizeMB: stats.size / (1024 * 1024),
        avgObjSize: stats.avgObjSize
      };
    } catch (error) {
      logger.error(`Error getting collection size: ${error.message}`);
      return null;
    }
  },

  /**
   * Clean up old transactions (optional, as TTL index handles this)
   * @param {number} olderThanHours - Delete transactions older than this many hours
   */
  async cleanupOldTransactions(olderThanHours = 48) {
    try {
      const collection = await this.getCollection();
      
      const cutoffTime = new Date(Date.now() - (olderThanHours * 60 * 60 * 1000));
      
      // Using timestamp index for efficient cleanup
      const result = await collection.deleteMany({
        timestamp: { $lt: cutoffTime }
      });
      
      if (result.deletedCount > 0) {
        logger.info(`Cleaned up ${result.deletedCount} old transactions`);
      }

      // Check size and perform more aggressive cleanup if necessary
      const collectionSize = await this.getCollectionSize();
      
      if (collectionSize && collectionSize.sizeMB > 250) { 
        logger.warn(`MongoDB collection size exceeds threshold (${collectionSize.sizeMB.toFixed(2)}MB), performing additional cleanup`);
        
        // Calculate how many documents to remove (30% of total)
        const excessCount = Math.floor(collectionSize.count * 0.3); 
        
        if (excessCount > 0) {
          // First, try to optimize by group and timestamp
          // Get groups with most transactions
          const groupStats = await collection.aggregate([
            { $group: { 
                _id: "$groupId", 
                count: { $sum: 1 } 
              } 
            },
            { $sort: { count: -1 } },
            { $limit: 10 }
          ]).toArray();
          
          // For each high-volume group, remove older transactions
          const cleanupPromises = [];
          for (const group of groupStats) {
            if (group.count > 1000) { // Only target high-volume groups
              const toRemove = Math.floor(group.count * 0.4); // More aggressive with high-volume groups
              
              cleanupPromises.push(
                collection.find({ groupId: group._id })
                .sort({ timestamp: 1 })
                .limit(toRemove)
                .toArray()
                .then(async (transactions) => {
                  if (transactions.length > 0) {
                    const ids = transactions.map(tx => tx._id);
                    const deleteResult = await collection.deleteMany({ _id: { $in: ids } });
                    return deleteResult.deletedCount;
                  }
                  return 0;
                })
              );
            }
          }
          
          // Wait for all group cleanups to complete
          const results = await Promise.all(cleanupPromises);
          const totalRemoved = results.reduce((sum, count) => sum + count, 0);
          
          // If group-based cleanup wasn't sufficient, fall back to removing oldest transactions
          if (totalRemoved < excessCount * 0.5) {
            logger.info(`Group-based cleanup removed ${totalRemoved} transactions, continuing with timestamp-based cleanup`);
            
            const remainingToRemove = excessCount - totalRemoved;
            const oldestTransactions = await collection.find({})
              .sort({ timestamp: 1 })
              .limit(remainingToRemove)
              .toArray();
              
            if (oldestTransactions.length > 0) {
              const oldestIds = oldestTransactions.map(tx => tx._id);
              const deleteResult = await collection.deleteMany({
                _id: { $in: oldestIds }
              });
              
              logger.info(`Additional timestamp-based cleanup removed ${deleteResult.deletedCount} oldest transactions`);
              totalRemoved += deleteResult.deletedCount;
            }
          }
          
          logger.info(`Emergency cleanup completed: removed ${totalRemoved} transactions in total`);
        }
      }
    } catch (error) {
      logger.error(`Error in transactionService.cleanupOldTransactions: ${error.message}`);
    }
  }
};

module.exports = transactionService;