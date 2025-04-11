const trackerService = require('./trackerService');
const groupService = require('./groupService');
const logger = require('../../utils/logger');

/**
 * Service for coordinating tracker and group operations
 * Note: No longer works with a dedicated "setups" collection,
 * as trackers now directly reference their groups.
 */
const setupService = {
  /**
   * Register tracking setup for a tracker in a group
   * @param {string} trackerName - Name of the tracker
   * @param {string} groupId - ID of the Telegram group
   * @param {string} groupName - Name of the Telegram group
   * @returns {Promise<boolean>} Success status
   */
  async registerTracking(trackerName, groupId, groupName) {
    try {
      // Find or create group first
      const group = await groupService.findOrCreate(groupId, groupName);
      
      // Find or create tracker specific to this group
      const tracker = await trackerService.findOrCreate(trackerName, groupId);
      
      logger.info(`Registered tracking for ${trackerName} in group ${groupName}`);
      return true;
    } catch (error) {
      logger.error(`Error in setupService.registerTracking: ${error.message}`);
      return false;
    }
  },

  /**
   * Remove tracking for a tracker in a group
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
      
      // Delete the tracker
      const success = await trackerService.delete(trackerName, groupId);
      
      if (success) {
        const group = await groupService.findByGroupId(groupId);
        logger.info(`Removed tracking: ${trackerName} from group ${group ? group.groupName : groupId}`);
      }
      
      return success;
    } catch (error) {
      logger.error(`Error in setupService.removeTracking: ${error.message}`);
      return false;
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
              settings: group.settings
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
        const success = await trackerService.updateStatus(tracker._id, false);
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