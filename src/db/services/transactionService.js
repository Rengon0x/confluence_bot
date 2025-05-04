// src/db/services/transactionService.js
const { getDatabase } = require('../connection');
const TransactionModel = require('../models/transaction');
const logger = require('../../utils/logger');
const performanceMonitor = require('../../utils/performanceMonitor');

// Cached collection reference to avoid repeated lookups
let cachedCollection = null;

/**
 * Service for handling transaction-related database operations - optimized for performance
 */
const transactionService = {
  /**
   * Get the transactions collection with caching
   * @returns {Promise<Collection>} The transactions collection
   */
  async getCollection() {
    if (cachedCollection) {
      return cachedCollection;
    }
    
    const db = await getDatabase();
    cachedCollection = db.collection(TransactionModel.collectionName);
    return cachedCollection;
  },

  /**
   * Store a transaction in the database - optimized for speed
   * @param {Object} transaction - The transaction to store
   * @param {string} groupId - The group ID this transaction belongs to
   * @returns {Promise<Object>} The stored transaction
   */
  async storeTransaction(transaction, groupId) {
    try {
      const collection = await this.getCollection();
      
      // Create a lean transaction document with only the necessary fields
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
        baseAmount: transaction.baseAmount || 0,
        baseSymbol: transaction.baseSymbol || '',
        walletAddress: transaction.walletAddress || '' // Include wallet address
      };
      
      // Use insertOne instead of the slower insertMany
      const result = await collection.insertOne(transactionDoc);
      
      // Use debug level for regular operations to reduce log volume
      logger.debug(`Transaction stored in MongoDB: ${transaction.type} ${transaction.coin} by ${transaction.walletName}, base amount: ${transaction.baseAmount} ${transaction.baseSymbol}`);
      
      return { ...transactionDoc, _id: result.insertedId };
    } catch (error) {
      logger.error(`Error in transactionService.storeTransaction: ${error.message}`);
      throw error;
    }
  },

  /**
   * Delete all transactions associated with a tracker in a specific group
   * Optimized for faster batch deletion
   * @param {string} trackerName - The tracker name
   * @param {string} groupId - The group ID
   * @returns {Promise<number>} Number of transactions deleted
   */
  async deleteTrackerTransactions(trackerName, groupId) {
    try {
      const collection = await this.getCollection();
      
      // Use case-insensitive regex for better matching
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
      
      // Delete in batches for better performance with large datasets
      const BATCH_SIZE = 5000;
      let totalDeleted = 0;
      let hasMore = true;
      
      while (hasMore) {
        // Get IDs for a batch of documents
        const documents = await collection.find({ groupId: groupId })
                                        .limit(BATCH_SIZE)
                                        .project({ _id: 1 })
                                        .toArray();
                                        
        if (documents.length === 0) {
          hasMore = false;
          break;
        }
        
        const ids = documents.map(doc => doc._id);
        
        // Delete the batch
        const result = await collection.deleteMany({ _id: { $in: ids } });
        totalDeleted += result.deletedCount;
        
        // Log progress for large batches
        if (documents.length === BATCH_SIZE) {
          logger.info(`Deleted ${totalDeleted} transactions so far for group ${groupId}`);
        }
      }
      
      logger.info(`Deleted ${totalDeleted} transactions for group ${groupId}`);
      return totalDeleted;
    } catch (error) {
      logger.error(`Error in transactionService.deleteGroupTransactions: ${error.message}`);
      return 0;
    }
  },

  /**
   * Get recent transactions for a specific group, type, and coin - optimized
   * @param {string} groupId - The group ID
   * @param {string} type - Transaction type (buy/sell)
   * @param {string} coin - Coin symbol
   * @param {string} coinAddress - Coin address
   * @param {number} windowMinutes - How far back to look in minutes
   * @returns {Promise<Array>} Recent transactions
   */
  async getRecentTransactions(groupId, type, coin, coinAddress, windowMinutes = 60) {
    try {
      const collection = await this.getCollection();
      
      const cutoffTime = new Date(Date.now() - (windowMinutes * 60 * 1000));
      
      // Build query based on available parameters
      const query = {
        groupId: groupId,
        timestamp: { $gte: cutoffTime }
      };
      
      if (type) {
        query.type = type;
      }
      
      let indexHint;
      
      if (coinAddress && coinAddress.length > 0) {
        query.coinAddress = coinAddress;
        indexHint = { groupId: 1, coinAddress: 1, timestamp: 1 };
      } else if (coin) {
        query.coin = coin;
        indexHint = { groupId: 1, coin: 1, timestamp: 1 };
      } else if (type) {
        indexHint = { groupId: 1, type: 1, timestamp: 1 };
      } else {
        indexHint = { groupId: 1, timestamp: 1 };
      }
      
      // Use appropriate index and sorting for better performance
      const transactions = await collection.find(query)
        .sort({ timestamp: -1 })
        .hint(indexHint)
        .toArray();
      
      return transactions;
    } catch (error) {
      // If hint fails, retry without hint
      if (error.message.includes('hint') || error.message.includes('index')) {
        logger.warn(`Index hint failed, retrying without hint: ${error.message}`);
        
        try {
          const collection = await this.getCollection();
          const cutoffTime = new Date(Date.now() - (windowMinutes * 60 * 1000));
          
          const query = {
            groupId: groupId,
            timestamp: { $gte: cutoffTime }
          };
          
          if (type) {
            query.type = type;
          }
          
          if (coinAddress && coinAddress.length > 0) {
            query.coinAddress = coinAddress;
          } else if (coin) {
            query.coin = coin;
          }
          
          return await collection.find(query)
            .sort({ timestamp: -1 })
            .toArray();
        } catch (fallbackError) {
          logger.error(`Fallback error in getRecentTransactions: ${fallbackError.message}`);
          return [];
        }
      }
      
      logger.error(`Error in transactionService.getRecentTransactions: ${error.message}`);
      return [];
    }
  },
  
  /**
   * Get all recent transactions by coin address for all transaction types - optimized
   * @param {string} groupId - Group ID
   * @param {string} coinAddress - Coin address
   * @param {number} windowMinutes - Time window in minutes
   * @returns {Promise<Array>} - Transactions
   */
  async getRecentTransactionsByAddress(groupId, coinAddress, windowMinutes = 2880) {
    try {
      const collection = await this.getCollection();
      
      const cutoffTime = new Date(Date.now() - (windowMinutes * 60 * 1000));
      
      // Create index hint for faster querying
      const indexHint = { groupId: 1, coinAddress: 1, timestamp: 1 };
      
      const query = {
        groupId: groupId,
        coinAddress: coinAddress,
        timestamp: { $gte: cutoffTime }
      };
      
      // Use projection to only return needed fields for better performance
      const projection = {
        _id: 1,
        walletName: 1,
        type: 1,
        coin: 1,
        coinAddress: 1,
        amount: 1,
        timestamp: 1,
        usdValue: 1,
        marketCap: 1,
        baseAmount: 1,
        baseSymbol: 1,
        walletAddress: 1
      };
      
      // Use the simple coinAddress index
      const transactions = await collection.find(query)
        .project(projection)
        .sort({ timestamp: -1 })
        .hint(indexHint)
        .toArray();
      
      return transactions;
    } catch (error) {
      // If hint fails, retry without hint
      if (error.message.includes('hint') || error.message.includes('index')) {
        logger.warn(`Index hint failed, retrying without hint: ${error.message}`);
        
        try {
          const collection = await this.getCollection();
          const cutoffTime = new Date(Date.now() - (windowMinutes * 60 * 1000));
          
          return await collection.find({
            groupId: groupId,
            coinAddress: coinAddress,
            timestamp: { $gte: cutoffTime }
          })
          .sort({ timestamp: -1 })
          .toArray();
        } catch (fallbackError) {
          logger.error(`Fallback error in getRecentTransactionsByAddress: ${fallbackError.message}`);
          return [];
        }
      }
      
      logger.error(`Error in getRecentTransactionsByAddress: ${error.message}`);
      return [];
    }
  },
  
  /**
   * Get all recent transactions by coin name for all transaction types - optimized
   * @param {string} groupId - Group ID
   * @param {string} coin - Coin name
   * @param {number} windowMinutes - Time window in minutes
   * @returns {Promise<Array>} - Transactions
   */
  async getRecentTransactionsByCoin(groupId, coin, windowMinutes = 2880) {
    try {
      const collection = await this.getCollection();
      
      const cutoffTime = new Date(Date.now() - (windowMinutes * 60 * 1000));
      
      // Create index hint for faster querying
      const indexHint = { groupId: 1, coin: 1, timestamp: 1 };
      
      const query = {
        groupId: groupId,
        coin: coin,
        timestamp: { $gte: cutoffTime }
      };
      
      // Use projection to only return needed fields
      const projection = {
        _id: 1,
        walletName: 1,
        type: 1,
        coin: 1,
        coinAddress: 1,
        amount: 1,
        timestamp: 1,
        usdValue: 1,
        marketCap: 1,
        baseAmount: 1,
        baseSymbol: 1,
        walletAddress: 1
      };
      
      // Let MongoDB choose the best index or use hint
      const transactions = await collection.find(query)
        .project(projection)
        .sort({ timestamp: -1 })
        .hint(indexHint)
        .toArray();
      
      return transactions;
    } catch (error) {
      // If hint fails, retry without hint
      if (error.message.includes('hint') || error.message.includes('index')) {
        logger.warn(`Index hint failed in getRecentTransactionsByCoin: ${error.message}`);
        
        try {
          const collection = await this.getCollection();
          const cutoffTime = new Date(Date.now() - (windowMinutes * 60 * 1000));
          
          return await collection.find({
            groupId: groupId,
            coin: coin,
            timestamp: { $gte: cutoffTime }
          })
          .sort({ timestamp: -1 })
          .toArray();
        } catch (fallbackError) {
          logger.error(`Fallback error in getRecentTransactionsByCoin: ${fallbackError.message}`);
          return [];
        }
      }
      
      logger.error(`Error in getRecentTransactionsByCoin: ${error.message}`);
      return [];
    }
  },
  
 /**
 * Load recent transactions for all groups - optimized for performance
 * @param {number} windowMinutes - How far back to look in minutes
 * @returns {Promise<Array>} Array of transactions
 */
 async loadRecentTransactions(windowMinutes = 60) {
    // Start measuring database performance
    const dbTimer = performanceMonitor.startTimer();
    const operationName = `load_transactions_${windowMinutes}min`;
    
    try {
      const collection = await this.getCollection();
      
      const cutoffTime = new Date(Date.now() - (windowMinutes * 60 * 1000));
      
      // Create an optimal query with projection to minimize data transfer
      const query = {
        timestamp: { $gte: cutoffTime }
      };
      
      // Only include fields we need
      const projection = {
        _id: 0,
        groupId: 1,
        walletName: 1,
        walletAddress: 1,
        type: 1,
        coin: 1,
        coinAddress: 1,
        amount: 1,
        timestamp: 1,
        usdValue: 1,
        marketCap: 1,
        baseAmount: 1,
        baseSymbol: 1
      };
      
      // Use a batch cursor for better memory efficiency
      const cursor = collection.find(query)
                             .project(projection)
                             .sort({ timestamp: -1 });
                             
      // Load transactions in batches to avoid memory issues
      const BATCH_SIZE = 5000;
      let transactions = [];
      let batch;
      
      do {
        batch = await cursor.limit(BATCH_SIZE).skip(transactions.length).toArray();
        
        if (batch.length > 0) {
          // Pre-process transactions to ensure consistent format
          for (const tx of batch) {
            // Fix missing fields
            if (!tx.type) {
              tx.type = tx.baseAmount > 0 ? 'buy' : 'sell';
            }
            if (tx.baseAmount === undefined) {
              tx.baseAmount = 0;
            }
            if (!tx.baseSymbol) {
              tx.baseSymbol = 'SOL';
            }
            if (tx.marketCap === undefined) {
              tx.marketCap = 0;
            }
          }
          
          transactions = transactions.concat(batch);
          
          // Log progress for large datasets
          if (transactions.length % 10000 === 0) {
            logger.debug(`Loaded ${transactions.length} recent transactions so far...`);
          }
        }
      } while (batch.length === BATCH_SIZE);
      
      // Measure query performance
      const queryTime = performanceMonitor.endTimer(dbTimer, 'mongoQueries', operationName);
      logger.info(`Loaded ${transactions.length} recent transactions from MongoDB (window: ${windowMinutes} min) in ${queryTime.toFixed(2)}ms`);
      
      return transactions;
    } catch (error) {
      // Record failure in performance monitor
      performanceMonitor.endTimer(dbTimer, 'mongoQueries', `${operationName}_error`);
      logger.error(`Error in transactionService.loadRecentTransactions: ${error.message}`);
      
      // Fallback to a simpler query if the optimized one fails
      try {
        logger.warn('Using fallback query for transaction loading');
        const fallbackTimer = performanceMonitor.startTimer();
        
        const collection = await this.getCollection();
        const cutoffTime = new Date(Date.now() - (windowMinutes * 60 * 1000));
        
        // Use simpler query without projection or advanced options
        const transactions = await collection.find({
          timestamp: { $gte: cutoffTime }
        }).toArray();
        
        // Measure fallback query performance
        const fallbackQueryTime = performanceMonitor.endTimer(fallbackTimer, 'mongoQueries', `${operationName}_fallback`);
        logger.warn(`Fallback query completed in ${fallbackQueryTime.toFixed(2)}ms`);
        
        // Process transactions for consistency
        for (const tx of transactions) {
          if (!tx.type) tx.type = tx.baseAmount > 0 ? 'buy' : 'sell';
          if (tx.baseAmount === undefined) tx.baseAmount = 0;
          if (!tx.baseSymbol) tx.baseSymbol = 'SOL';
          if (tx.marketCap === undefined) tx.marketCap = 0;
        }
        
        return transactions;
      } catch (fallbackError) {
        logger.error(`Fallback error in loadRecentTransactions: ${fallbackError.message}`);
        return [];
      }
    }
  },

  /**
   * Get collection size statistics
   * @returns {Promise<Object>} Collection statistics
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
   * Clean up old transactions based on each group's window setting
   * High performance version with batched processing
   * @param {number} maxHours - Maximum age in hours to keep transactions
   * @returns {Promise<number>} Total deleted transactions
   */
  async cleanupOldTransactions(maxHours = 48) {
    try {
      const collection = await this.getCollection();
      
      // Get all unique group IDs from the transactions
      const groupIds = await collection.distinct('groupId');
      
      if (!groupIds || groupIds.length === 0) {
        logger.debug('No groups found for transaction cleanup');
        return 0;
      }
      
      // Import the group service directly here to avoid circular imports
      const groupService = require('./groupService');
      
      let totalDeleted = 0;
      
      // Process groups in batches (to avoid memory pressure)
      const BATCH_SIZE = 5;
      for (let i = 0; i < groupIds.length; i += BATCH_SIZE) {
        const batchGroups = groupIds.slice(i, i + BATCH_SIZE);
        const promises = batchGroups.map(async (groupId) => {
          try {
            // Get group settings to get the specific window minutes for this group
            const groupSettings = await groupService.getSettings(groupId);
            
            // Import config here to avoid circular dependencies
            const config = require('../../config/config');
            
            // Use group-specific settings or default from config
            const windowMinutes = Math.min(
              groupSettings?.windowMinutes || config.confluence.windowMinutes,
              maxHours * 60  // Cap at maxHours to prevent excessive retention
            );
            
            // Calculate cutoff time for this specific group
            const cutoffTime = new Date(Date.now() - (windowMinutes * 60 * 1000));
            
            // Delete in batches for large groups
            let groupDeleted = 0;
            let hasMore = true;
            
            while (hasMore) {
              // Get IDs for a batch of documents to delete
              const documents = await collection.find({
                groupId: groupId,
                timestamp: { $lt: cutoffTime }
              })
              .limit(5000)
              .project({ _id: 1 })
              .toArray();
              
              if (documents.length === 0) {
                hasMore = false;
                break;
              }
              
              const ids = documents.map(doc => doc._id);
              
              // Delete the batch
              const result = await collection.deleteMany({ _id: { $in: ids } });
              groupDeleted += result.deletedCount;
              
              // If remaining documents < batch size, we're done
              if (documents.length < 5000) {
                hasMore = false;
              }
            }
            
            if (groupDeleted > 0) {
              logger.info(`Cleaned up ${groupDeleted} old transactions for group ${groupId} (window: ${windowMinutes} minutes)`);
            }
            
            return groupDeleted;
          } catch (groupError) {
            logger.error(`Error cleaning transactions for group ${groupId}: ${groupError.message}`);
            return 0;
          }
        });
        
        // Wait for each batch to complete
        const results = await Promise.all(promises);
        totalDeleted += results.reduce((sum, count) => sum + count, 0);
        
        // Add a small delay between batches to avoid database overload
        if (i + BATCH_SIZE < groupIds.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      
      // Emergency cleanup for excessive database size
      const collectionSize = await this.getCollectionSize();
      
      if (collectionSize && collectionSize.sizeMB > 250) { 
        const additionalDeleted = await this.performEmergencyCleanup(collection, collectionSize);
        totalDeleted += additionalDeleted;
      }

      return totalDeleted;
    } catch (error) {
      logger.error(`Error in transactionService.cleanupOldTransactions: ${error.message}`);
      return 0;
    }
  },
  
  /**
   * Perform emergency cleanup when the collection size is too large
   * @param {Collection} collection - MongoDB collection
   * @param {Object} collectionSize - Collection size info
   * @returns {Promise<number>} Number of deleted documents
   */
  async performEmergencyCleanup(collection, collectionSize) {
    try {
      logger.warn(`MongoDB collection size exceeds threshold (${collectionSize.sizeMB.toFixed(2)}MB), performing additional cleanup`);
      
      // Get transaction counts by group
      const groupStats = await collection.aggregate([
        { $group: { 
            _id: "$groupId", 
            count: { $sum: 1 } 
          } 
        },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]).toArray();
      
      // Focus cleanup on high-volume groups
      let totalRemoved = 0;
      
      for (const group of groupStats) {
        if (group.count > 1000) {
          // Determine how many to remove (40% of this group's transactions)
          const removeCount = Math.floor(group.count * 0.4);
          
          // Get oldest documents in this group
          const oldestDocs = await collection.find({ groupId: group._id })
            .sort({ timestamp: 1 })
            .limit(removeCount)
            .project({ _id: 1 })
            .toArray();
            
          if (oldestDocs.length > 0) {
            const ids = oldestDocs.map(doc => doc._id);
            
            // Delete in batches to avoid timeout issues
            const BATCH_SIZE = 1000;
            for (let i = 0; i < ids.length; i += BATCH_SIZE) {
              const batchIds = ids.slice(i, i + BATCH_SIZE);
              const result = await collection.deleteMany({ _id: { $in: batchIds } });
              totalRemoved += result.deletedCount;
            }
            
            logger.info(`Emergency cleanup: removed ${totalRemoved} old transactions from group ${group._id}`);
          }
        }
      }
      
      // If group-based cleanup wasn't sufficient, do a global cleanup based on timestamp
      if (totalRemoved < collectionSize.count * 0.2) {
        logger.info(`Additional global cleanup needed, performing timestamp-based cleanup`);
        
        // Find a cutoff timestamp that would remove 20% of remaining documents
        const minTs = await collection.find().sort({ timestamp: 1 }).limit(1).project({ timestamp: 1 }).toArray();
        const maxTs = await collection.find().sort({ timestamp: -1 }).limit(1).project({ timestamp: 1 }).toArray();
        
        if (minTs.length > 0 && maxTs.length > 0) {
          const minTime = new Date(minTs[0].timestamp).getTime();
          const maxTime = new Date(maxTs[0].timestamp).getTime();
          const timeRange = maxTime - minTime;
          
          // Target removing the oldest 20% of documents
          const cutoffTime = new Date(minTime + (timeRange * 0.2));
          
          // Delete all transactions older than cutoff
          const result = await collection.deleteMany({ timestamp: { $lt: cutoffTime } });
          totalRemoved += result.deletedCount;
          
          logger.info(`Global timestamp cleanup: removed ${result.deletedCount} transactions before ${cutoffTime.toISOString()}`);
        }
      }
      
      return totalRemoved;
    } catch (error) {
      logger.error(`Error in emergency cleanup: ${error.message}`);
      return 0;
    }
  }
};

module.exports = transactionService;