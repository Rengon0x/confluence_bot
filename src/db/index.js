/**
 * Database module entry point
 */
const { connectToDatabase, getDatabase } = require('./connection');
const trackerService = require('./services/trackerService');
const groupService = require('./services/groupService');
const setupService = require('./services/setupService');
const transactionService = require('./services/transactionService');
const validators = require('./utils/validators');

// Export everything
module.exports = {
  // Connection
  connectToDatabase,
  getDatabase,

  closeConnection: require('./connection').closeConnection,
  
  // Services
  trackerService,
  groupService,
  setupService,
  transactionService,
  
  // Utils
  validators,
  
  // Helper methods for easy access
  
  // Register tracking setup
  async registerTracking(trackerName, groupId, groupName, trackerType = 'cielo', userId = null, username = null) {
    return setupService.registerTracking(trackerName, groupId, groupName, trackerType, userId, username);
  },
  
  // Remove tracking setup
  async removeTracking(trackerName, groupId) {
    return setupService.removeTracking(trackerName, groupId);
  },
  
  // Get all trackers for a group
  async getGroupTrackers(groupId) {
    return setupService.getTrackersForGroup(groupId);
  },
  
  // Get all groups for a tracker
  async getGroupsForTracker(trackerName) {
    return setupService.getGroupsForTracker(trackerName);
  },
  
  // Get settings for a group
  async getGroupSettings(groupId) {
    return groupService.getSettings(groupId);
  },
  
  // Update settings for a group
  async updateGroupSettings(groupId, settings) {
    // Validate settings before updating
    const validatedSettings = validators.validateSettings(settings);
    return groupService.updateSettings(groupId, validatedSettings);
  },
  
  // Get all active trackers
  async getAllActiveTrackers() {
    return trackerService.getAllActive();
  },

    // Transaction Service helpers
    async storeTransaction(transaction, groupId) {
    return transactionService.storeTransaction(transaction, groupId);
    },

    async getRecentTransactions(groupId, type, coin, windowMinutes) {
    return transactionService.getRecentTransactions(groupId, type, coin, windowMinutes);
    }
};