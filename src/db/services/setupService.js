const trackerService = require('./trackerService');
const groupService = require('./groupService');
const transactionService = require('./transactionService');
const logger = require('../../utils/logger');

/**
 * Service for coordinating tracker and group operations with tracker type
 */
const setupService = {
  /**
   * Register tracking setup for a tracker in a group
   * @param {string} trackerName - Name of the tracker
   * @param {string} groupId - ID of the Telegram group
   * @param {string} groupName - Name of the Telegram group
   * @param {string} trackerType - Type of the tracker ('cielo', 'defined', 'ray')
   * @returns {Promise<boolean>} Success status
   */
  async registerTracking(trackerName, groupId, groupName, trackerType = 'cielo') {
    try {
      // Find or create group first
      const group = await groupService.findOrCreate(groupId, groupName);
      
      // Find or create tracker specific to this group with type
      const tracker = await trackerService.findOrCreate(trackerName, groupId, trackerType);
      
      logger.info(`Registered tracking for ${trackerName} (${trackerType}) in group ${groupName}`);
      return true;
    } catch (error) {
      logger.error(`Error in setupService.registerTracking: ${error.message}`);
      return false;
    }
  },

  /**
   * Remove tracking for a tracker in a group and clean up associated data
   * @param {string} trackerName - Name of the tracker
   * @param {string} groupId - ID of the Telegram group
   * @returns {Promise<boolean>} Success status
   */
  async removeTracking(trackerName, groupId) {
    try {
      // Find the tracker specific to this group
      const tracker = await trackerService.findByNameAndGroup(trackerName, groupId);
      
      if (!tracker) {
        logger.warn(`Could not find tracker ${trackerName} for group ${groupId}`);
        return false;
      }
      
      // Delete all transactions associated with this tracker in this group
      const deletedTransactions = await this.cleanupTrackerData(trackerName, groupId);
      
      // Delete the tracker
      const success = await trackerService.delete(trackerName, groupId);
      
      if (success) {
        const group = await groupService.findByGroupId(groupId);
        logger.info(`Removed tracking: ${trackerName} from group ${group ? group.groupName : groupId}`);
        logger.info(`Cleaned up ${deletedTransactions} transactions associated with this tracker`);
      }
      
      return success;
    } catch (error) {
      logger.error(`Error in setupService.removeTracking: ${error.message}`);
      return false;
    }
  },

  /**
   * Clean up all data associated with a tracker in a specific group
   * @param {string} trackerName - Name of the tracker
   * @param {string} groupId - ID of the Telegram group
   * @returns {Promise<number>} Number of transactions deleted
   */
  async cleanupTrackerData(trackerName, groupId) {
    try {
      // Delete all transactions from this tracker in this group
      const result = await transactionService.deleteTrackerTransactions(trackerName, groupId);
      
      // Clean up cached data for this tracker
      await this.cleanupCachedData(trackerName, groupId);
      
      return result;
    } catch (error) {
      logger.error(`Error in setupService.cleanupTrackerData: ${error.message}`);
      return 0;
    }
  },

  /**
   * Clean up cached data for a tracker in a specific group
   * @param {string} trackerName - Name of the tracker
   * @param {string} groupId - ID of the Telegram group
   */
  async cleanupCachedData(trackerName, groupId) {
    try {
      const confluenceService = require('../../services/confluenceService');
      
      // Get all cache keys
      const keys = await confluenceService.transactionsCache.keys();
      
      // Filter keys related to this group
      const groupKeys = keys.filter(key => key.startsWith(`${groupId}_`));
      
      // Check each key for transactions from the specified tracker
      for (const key of groupKeys) {
        const transactions = await confluenceService.transactionsCache.get(key);
        
        if (transactions && Array.isArray(transactions)) {
          // Filter out transactions from the specified tracker
          const filteredTransactions = transactions.filter(
            tx => tx.walletName.toLowerCase() !== trackerName.toLowerCase()
          );
          
          // If all transactions were from this tracker, delete the key
          if (filteredTransactions.length === 0) {
            await confluenceService.transactionsCache.del(key);
          }
          // Otherwise, update with filtered transactions
          else if (filteredTransactions.length !== transactions.length) {
            await confluenceService.transactionsCache.set(key, filteredTransactions);
          }
        }
      }
      
      logger.info(`Cleaned up cached data for tracker ${trackerName} in group ${groupId}`);
    } catch (error) {
      logger.error(`Error in setupService.cleanupCachedData: ${error.message}`);
    }
  },

  /**
   * Get all trackers for a group
   * @param {string} groupId - ID of the Telegram group
   * @returns {Promise<Array>} List of trackers for this group
   */
  async getTrackersForGroup(groupId) {
    try {
      // Get all trackers specific to this group
      const trackers = await trackerService.getActiveForGroup(groupId);
      
      return trackers.map(tracker => ({
        trackerId: tracker._id,
        trackerName: tracker.name,
        type: tracker.type || 'cielo', // Default to cielo for backward compatibility
        active: tracker.active,
        createdAt: tracker.createdAt
      }));
    } catch (error) {
      logger.error(`Error in setupService.getTrackersForGroup: ${error.message}`);
      return [];
    }
  },

  /**
   * Get all groups for a tracker name
   * @param {string} trackerName - Name of the tracker
   * @returns {Promise<Array>} List of groups using this tracker name
   */
  async getGroupsForTracker(trackerName) {
    try {
      // Find all trackers with this name (across groups)
      const trackers = await trackerService.findByName(trackerName);
      
      // Get group details for each tracker
      const groups = [];
      for (const tracker of trackers) {
        if (tracker.active) {
          const group = await groupService.findByGroupId(tracker.groupId);
          if (group) {
            groups.push({
              id: group.groupId,
              name: group.groupName,
              settings: group.settings,
              trackerType: tracker.type || 'cielo'
            });
          }
        }
      }
      
      return groups;
    } catch (error) {
      logger.error(`Error in setupService.getGroupsForTracker: ${error.message}`);
      return [];
    }
  },
  
  /**
   * Deactivate all trackers for a group
   * @param {string} groupId - Group ID
   * @returns {Promise<boolean>} Success status
   */
  async deactivateAllForGroup(groupId) {
    try {
      const trackers = await trackerService.getActiveForGroup(groupId);
      let allSuccessful = true;
      
      for (const tracker of trackers) {
        const success = await this.removeTracking(tracker.name, groupId);
        if (!success) allSuccessful = false;
      }
      
      return allSuccessful;
    } catch (error) {
      logger.error(`Error in setupService.deactivateAllForGroup: ${error.message}`);
      return false;
    }
  }
};

module.exports = setupService;