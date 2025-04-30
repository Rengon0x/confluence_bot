// src/db/services/cleanupService.js
const { getDatabase } = require('../connection');
const TransactionModel = require('../models/transaction');
const TrackerModel = require('../models/tracker');
const logger = require('../../utils/logger');

/**
 * Service for cleaning up orphaned data in the database
 */
const cleanupService = {
  /**
   * Clean up orphaned transactions that belong to non-existent trackers
   * @returns {Promise<number>} Number of transactions deleted
   */
  async cleanupOrphanedTransactions() {
    try {
      const db = await getDatabase();
      const transactionsCollection = db.collection(TransactionModel.collectionName);
      const trackersCollection = db.collection(TrackerModel.collectionName);
      
      logger.info('Starting cleanup of orphaned transactions...');
      
      // Get all active tracker names with their group IDs
      const activeTrackers = await trackersCollection.find({}).toArray();
      
      // Create a map of valid tracker-group combinations
      const validTrackerGroups = new Map();
      for (const tracker of activeTrackers) {
        const key = `${tracker.name}:${tracker.groupId}`;
        validTrackerGroups.set(key, true);
      }
      
      // Get all unique combinations of walletName and groupId from transactions
      const transactionCombinations = await transactionsCollection.aggregate([
        {
          $group: {
            _id: {
              walletName: '$walletName',
              groupId: '$groupId'
            },
            count: { $sum: 1 }
          }
        }
      ]).toArray();
      
      // Find orphaned combinations
      const orphanedCombinations = [];
      for (const combination of transactionCombinations) {
        const walletName = combination._id.walletName;
        const groupId = combination._id.groupId;
        
        // Check if the group ID still exists in active trackers
        let isValid = false;
        
        // Consider a transaction valid if its group ID matches an active tracker's group ID
        for (const tracker of activeTrackers) {
          if (tracker.groupId === groupId && tracker.active !== false) {
            isValid = true;
            break;
          }
        }
        
        // Only consider it orphaned if:
        // 1. The group ID doesn't match any active tracker's group ID, OR
        // 2. The transaction is older than the group's time window (checked elsewhere)
        if (!isValid) {
          orphanedCombinations.push({
            walletName: walletName,
            groupId: groupId
          });
        }
      }
      
      // Delete orphaned transactions
      if (orphanedCombinations.length > 0) {
        const deletePromises = orphanedCombinations.map(combination => 
          transactionsCollection.deleteMany({
            walletName: combination.walletName,
            groupId: combination.groupId
          })
        );
        
        const results = await Promise.all(deletePromises);
        const totalDeleted = results.reduce((sum, result) => sum + result.deletedCount, 0);
        
        logger.info(`Cleanup completed: Deleted ${totalDeleted} orphaned transactions`);
        logger.info(`Orphaned combinations cleaned: ${orphanedCombinations.length}`);
        
        // Log details for tracking
        orphanedCombinations.forEach(combo => {
          logger.debug(`Cleaned orphaned transactions for wallet: ${combo.walletName} in group: ${combo.groupId}`);
        });
        
        return totalDeleted;
      } else {
        logger.info('No orphaned transactions found');
        return 0;
      }
    } catch (error) {
      logger.error(`Error in cleanupOrphanedTransactions: ${error.message}`);
      return 0;
    }
  },
  
  /**
   * Run all cleanup tasks
   * @returns {Promise<Object>} Summary of cleanup operations
   */
  async runAllCleanupTasks() {
    const startTime = Date.now();
    
    try {
      // Run cleanup tasks
      const orphanedTransactionsDeleted = await this.cleanupOrphanedTransactions();
      
      // You can add more cleanup tasks here in the future
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      const summary = {
        orphanedTransactionsDeleted,
        duration,
        timestamp: new Date()
      };
      
      logger.info(`Database cleanup completed in ${duration}ms`);
      logger.info(`Summary: ${JSON.stringify(summary)}`);
      
      return summary;
    } catch (error) {
      logger.error(`Error in runAllCleanupTasks: ${error.message}`);
      return {
        error: error.message,
        duration: Date.now() - startTime,
        timestamp: new Date()
      };
    }
  },
  
  /**
   * Perform a dry run to check what would be cleaned up
   * @returns {Promise<Object>} Report of what would be cleaned up
   */
  async dryRun() {
    try {
      const db = await getDatabase();
      const transactionsCollection = db.collection(TransactionModel.collectionName);
      const trackersCollection = db.collection(TrackerModel.collectionName);
      
      // Get all active tracker names with their group IDs
      const activeTrackers = await trackersCollection.find({}).toArray();
      
      // Get all unique combinations of walletName and groupId from transactions
      const transactionCombinations = await transactionsCollection.aggregate([
        {
          $group: {
            _id: {
              walletName: '$walletName',
              groupId: '$groupId'
            },
            count: { $sum: 1 }
          }
        }
      ]).toArray();
      
      // Find orphaned combinations
      const orphanedCombinations = [];
      for (const combination of transactionCombinations) {
        const walletName = combination._id.walletName;
        const groupId = combination._id.groupId;
        
        // Check if the group ID still exists in active trackers
        let isValid = false;
        
        // Consider a transaction valid if its group ID matches an active tracker's group ID
        for (const tracker of activeTrackers) {
          if (tracker.groupId === groupId && tracker.active !== false) {
            isValid = true;
            break;
          }
        }
        
        // Only consider it orphaned if the group ID doesn't match any active tracker's group ID
        if (!isValid) {
          orphanedCombinations.push({
            walletName: walletName,
            groupId: groupId,
            count: combination.count
          });
        }
      }
      
      const totalOrphanedTransactions = orphanedCombinations.reduce((sum, combo) => sum + combo.count, 0);
      
      return {
        orphanedCombinations: orphanedCombinations,
        totalOrphanedTransactions: totalOrphanedTransactions,
        activeTrackers: activeTrackers.length,
        totalTransactionCombinations: transactionCombinations.length
      };
    } catch (error) {
      logger.error(`Error in dryRun: ${error.message}`);
      return { error: error.message };
    }
  }
};

module.exports = cleanupService;