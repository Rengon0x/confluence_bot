// src/services/confluence/groupSettingsManager.js
const logger = require('../../utils/logger');
const config = require('../../config/config');

/**
 * Manages group-specific settings for confluence detection
 */
const groupSettingsManager = {
  /**
   * Get minimum wallets setting for a group
   * @param {string} groupId - Group ID
   * @returns {Promise<number>} Minimum wallets setting
   */
  async getMinWalletsForGroup(groupId) {
    try {
      // Get the group settings from database
      const groupSettings = await require('../../db').getGroupSettings(groupId);
      
      // Use the group setting if available, otherwise use default
      return groupSettings && groupSettings.minWallets !== undefined 
        ? groupSettings.minWallets 
        : config.confluence.minWallets;
    } catch (error) {
      logger.error(`Error getting minWallets for group ${groupId}: ${error.message}`);
      return config.confluence.minWallets; // Fallback to default
    }
  },

  /**
   * Get time window setting for a group
   * @param {string} groupId - Group ID
   * @returns {Promise<number>} Time window in minutes
   */
  async getWindowMinutesForGroup(groupId) {
    try {
      // Get the group settings from database
      const groupSettings = await require('../../db').getGroupSettings(groupId);
      
      // Use the group setting if available, otherwise use default
      return groupSettings && groupSettings.windowMinutes !== undefined 
        ? groupSettings.windowMinutes 
        : config.confluence.windowMinutes;
    } catch (error) {
      logger.error(`Error getting windowMinutes for group ${groupId}: ${error.message}`);
      return config.confluence.windowMinutes; // Fallback to default
    }
  },

  /**
   * Get all settings for a group
   * @param {string} groupId - Group ID
   * @returns {Promise<Object>} Group settings
   */
  async getAllGroupSettings(groupId) {
    try {
      // Get the group settings from database
      const groupSettings = await require('../../db').getGroupSettings(groupId);
      
      // Combine with defaults for any missing values
      return {
        minWallets: groupSettings?.minWallets ?? config.confluence.minWallets,
        windowMinutes: groupSettings?.windowMinutes ?? config.confluence.windowMinutes
      };
    } catch (error) {
      logger.error(`Error getting settings for group ${groupId}: ${error.message}`);
      // Return defaults
      return {
        minWallets: config.confluence.minWallets,
        windowMinutes: config.confluence.windowMinutes
      };
    }
  }
};

module.exports = groupSettingsManager;