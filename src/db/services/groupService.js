const { ObjectId } = require('mongodb');
const { getDatabase } = require('../connection');
const GroupModel = require('../models/group');
const logger = require('../../utils/logger');
const config = require('../../config/config');

/**
 * Service for handling group-related database operations
 */
const groupService = {
  /**
   * Get the groups collection
   * @returns {Promise<Collection>} The groups collection
   */
  async getCollection() {
    const db = await getDatabase();
    return db.collection(GroupModel.collectionName || 'groups');
  },

  /**
   * Find or create a group by groupId
   * @param {string} groupId - The Telegram group ID
   * @param {string} groupName - The group name
   * @returns {Promise<Object>} The group document
   */
  async findOrCreate(groupId, groupName) {
    try {
      const collection = await this.getCollection();
      
      // Try to find the group
      let group = await collection.findOne({ groupId });
      
      // If it doesn't exist, create it
      if (!group) {
        logger.info(`Creating new group: ${groupName} (${groupId})`);
        const now = new Date();
        
        // Use configuration defaults for new group settings
        const defaultSettings = {
          minWallets: config.confluence.minWallets,
          windowMinutes: config.confluence.windowMinutes
        };
        
        const result = await collection.insertOne({
          groupId,
          groupName,
          settings: defaultSettings,
          active: GroupModel.defaults.active,
          createdAt: now,
          updatedAt: now
        });
        
        group = {
          _id: result.insertedId,
          groupId,
          groupName,
          settings: defaultSettings,
          active: GroupModel.defaults.active,
          createdAt: now,
          updatedAt: now
        };
      } 
      // If name has changed, update it
      else if (group.groupName !== groupName) {
        await collection.updateOne(
          { _id: group._id },
          { $set: { groupName, updatedAt: new Date() } }
        );
        
        group.groupName = groupName;
        group.updatedAt = new Date();
      }
      
      // Ensure settings exist with defaults if missing
      if (!group.settings) {
        group.settings = {
          minWallets: config.confluence.minWallets,
          windowMinutes: config.confluence.windowMinutes
        };
        
        await collection.updateOne(
          { _id: group._id },
          { $set: { settings: group.settings } }
        );
      } else {
        // Fill in missing values with defaults
        if (!group.settings.minWallets) {
          group.settings.minWallets = config.confluence.minWallets;
        }
        if (!group.settings.windowMinutes) {
          group.settings.windowMinutes = config.confluence.windowMinutes;
        }
      }
      
      return group;
    } catch (error) {
      logger.error(`Error in groupService.findOrCreate: ${error.message}`);
      throw error;
    }
  },

  /**
   * Find a group by groupId
   * @param {string} groupId - The Telegram group ID
   * @returns {Promise<Object|null>} The group document or null
   */
  async findByGroupId(groupId) {
    try {
      const collection = await this.getCollection();
      return await collection.findOne({ groupId });
    } catch (error) {
      logger.error(`Error in groupService.findByGroupId: ${error.message}`);
      throw error;
    }
  },

  /**
   * Find a group by ID
   * @param {string} id - The group ID
   * @returns {Promise<Object|null>} The group document or null
   */
  async findById(id) {
    try {
      const collection = await this.getCollection();
      return await collection.findOne({ _id: new ObjectId(id) });
    } catch (error) {
      logger.error(`Error in groupService.findById: ${error.message}`);
      throw error;
    }
  },

  /**
   * Get all active groups
   * @returns {Promise<Array>} Array of active group documents
   */
  async getAllActive() {
    try {
      const collection = await this.getCollection();
      return await collection.find({ active: true }).toArray();
    } catch (error) {
      logger.error(`Error in groupService.getAllActive: ${error.message}`);
      return [];
    }
  },

  /**
   * Get settings for a group
   * @param {string} groupId - The Telegram group ID
   * @returns {Promise<Object|null>} Group settings or null
   */
  async getSettings(groupId) {
    try {
      const collection = await this.getCollection();
      const group = await collection.findOne({ groupId });
      
      if (!group) return null;
      
      // Return settings with defaults filled in if missing
      return {
        minWallets: group.settings?.minWallets || config.confluence.minWallets,
        windowMinutes: group.settings?.windowMinutes || config.confluence.windowMinutes
      };
    } catch (error) {
      logger.error(`Error in groupService.getSettings: ${error.message}`);
      throw error;
    }
  },

  /**
   * Update settings for a group
   * @param {string} groupId - The Telegram group ID
   * @param {Object} settings - New settings
   * @returns {Promise<Object|null>} Updated group or null
   */
  async updateSettings(groupId, settings) {
    try {
      const collection = await this.getCollection();
      const group = await collection.findOne({ groupId });
      if (!group) return null;
      
      // Update only valid settings fields
      const updateFields = {};
      if (settings.minWallets !== undefined) {
        updateFields['settings.minWallets'] = settings.minWallets;
      }
      if (settings.windowMinutes !== undefined) {
        updateFields['settings.windowMinutes'] = settings.windowMinutes;
      }
      
      if (Object.keys(updateFields).length > 0) {
        updateFields.updatedAt = new Date();
        
        const result = await collection.findOneAndUpdate(
          { groupId },
          { $set: updateFields },
          { returnDocument: 'after' }
        );
        
        return result.value;
      }
      
      return group;
    } catch (error) {
      logger.error(`Error in groupService.updateSettings: ${error.message}`);
      throw error;
    }
  },

  /**
   * Update group status
   * @param {string} groupId - The Telegram group ID
   * @param {boolean} active - New active status
   * @returns {Promise<Object|null>} Updated group or null
   */
  async updateStatus(groupId, active) {
    try {
      const collection = await this.getCollection();
      const result = await collection.findOneAndUpdate(
        { groupId },
        { $set: { active, updatedAt: new Date() } },
        { returnDocument: 'after' }
      );
      
      return result.value;
    } catch (error) {
      logger.error(`Error in groupService.updateStatus: ${error.message}`);
      throw error;
    }
  },
  
  /**
   * Delete a group
   * @param {string} groupId - Group ID
   * @returns {Promise<boolean>} Success status
   */
  async delete(groupId) {
    try {
      const collection = await this.getCollection();
      const result = await collection.deleteOne({ groupId });
      return result.deletedCount > 0;
    } catch (error) {
      logger.error(`Error in groupService.delete: ${error.message}`);
      return false;
    }
  }
};

module.exports = groupService;