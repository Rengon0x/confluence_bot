// src/db/services/transactionService.js
const { getDatabase } = require('../connection');
const TransactionModel = require('../models/transaction');
const logger = require('../../utils/logger');

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
      
      if (coinAddress && coinAddress.length > 0) {
        query.coinAddress = coinAddress;
      } else if (coin) {
        query.coin = coin;
      }
      
      const transactions = await collection.find(query).toArray();
      
      return transactions;
    } catch (error) {
      logger.error(`Error in transactionService.getRecentTransactions: ${error.message}`);
      return [];
    }
  },

 /**
 * Load recent transactions for all groups
 * @param {number} windowMinutes - How far back to look in minutes
 * @returns {Promise<Object>} Map of transactions by key (groupId_type_coin)
 */
 async loadRecentTransactions(windowMinutes = 60) {
    try {
      const collection = await this.getCollection();
      
      const cutoffTime = new Date(Date.now() - (windowMinutes * 60 * 1000));
      
      const transactions = await collection.find({
        timestamp: { $gte: cutoffTime }
      }).toArray();
      
      logger.info(`Loaded ${transactions.length} recent transactions from MongoDB (window: ${windowMinutes} min)`);
      
      // Ensure all required fields are present and valid
      transactions.forEach(tx => {
        // Ensure type is properly set
        if (!tx.type) {
          // If type is missing, try to infer it based on baseAmount
          tx.type = tx.baseAmount > 0 ? 'buy' : 'sell';
          logger.debug(`Inferred type '${tx.type}' for transaction by ${tx.walletName} for ${tx.coin}`);
        }
        
        // Ensure baseAmount is set
        if (tx.baseAmount === undefined) {
          tx.baseAmount = 0;
          logger.debug(`Setting default baseAmount 0 for transaction by ${tx.walletName}`);
        }
        
        // Ensure baseSymbol is set
        if (!tx.baseSymbol) {
          tx.baseSymbol = 'SOL';
          logger.debug(`Setting default baseSymbol 'SOL' for transaction by ${tx.walletName}`);
        }
        
        // Ensure marketCap is set
        if (tx.marketCap === undefined) {
          tx.marketCap = 0;
          logger.debug(`Setting default marketCap 0 for transaction by ${tx.walletName}`);
        }
      });
      
      return transactions;
    } catch (error) {
      logger.error(`Error in transactionService.loadRecentTransactions: ${error.message}`);
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
      
      const result = await collection.deleteMany({
        timestamp: { $lt: cutoffTime }
      });
      
      if (result.deletedCount > 0) {
        logger.info(`Cleaned up ${result.deletedCount} old transactions`);
      }

       // Check size and cleanup if necessary
        const collectionSize = await this.getCollectionSize();
        
        if (collectionSize && collectionSize.sizeMB > 250) { 
        logger.warn(`MongoDB collection size exceeds threshold (${collectionSize.sizeMB.toFixed(2)}MB), performing additional cleanup`);
        
        const excessCount = Math.floor(collectionSize.count * 0.3); 
        
        if (excessCount > 0) {
            const oldestTransactions = await collection.find({})
            .sort({ timestamp: 1 })
            .limit(excessCount)
            .toArray();
            
            if (oldestTransactions.length > 0) {
            const oldestIds = oldestTransactions.map(tx => tx._id);
            
            const deleteResult = await collection.deleteMany({
                _id: { $in: oldestIds }
            });
            
            logger.info(`Emergency cleanup completed: removed ${deleteResult.deletedCount} oldest transactions`);
            }
        }
      }
    } catch (error) {
      logger.error(`Error in transactionService.cleanupOldTransactions: ${error.message}`);
    }
  }
};

module.exports = transactionService;