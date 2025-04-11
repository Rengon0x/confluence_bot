const { ObjectId } = require('mongodb');
const { getDatabase } = require('../connection');
const TrackerModel = require('../models/tracker');
const logger = require('../../utils/logger');

/**
 * Service for handling tracker-related database operations
 */
const trackerService = {
  /**
   * Get the trackers collection
   * @returns {Promise<Collection>} The trackers collection
   */
  async getCollection() {
    const db = await getDatabase();
    return db.collection(TrackerModel.collectionName || 'trackers');
  },

  /**
   * Find or create a tracker by name and groupId
   * @param {string} name - The tracker name
   * @param {string} groupId - The group ID this tracker belongs to
   * @returns {Promise<Object>} The tracker document
   */
  async findOrCreate(name, groupId) {
    try {
      const collection = await this.getCollection();
      
      // Try to find the tracker for this specific group
      let tracker = await collection.findOne({ name, groupId });
      
      // If it doesn't exist, create it
      if (!tracker) {
        logger.info(`Creating new tracker: ${name} for group ${groupId}`);
        const now = new Date();
        
        const result = await collection.insertOne({
          name,
          groupId,
          active: TrackerModel.defaults.active,
          createdAt: now,
          updatedAt: now
        });
        
        tracker = {
          _id: result.insertedId,
          name,
          groupId,
          active: TrackerModel.defaults.active,
          createdAt: now,
          updatedAt: now
        };
      }
      
      return tracker;
    } catch (error) {
      logger.error(`Error in trackerService.findOrCreate: ${error.message}`);
      throw error;
    }
  },

  /**
   * Find a tracker by name and groupId
   * @param {string} name - The tracker name
   * @param {string} groupId - The group ID this tracker belongs to
   * @returns {Promise<Object|null>} The tracker document or null
   */
  async findByNameAndGroup(name, groupId) {
    try {
      const collection = await this.getCollection();
      return await collection.findOne({ name, groupId });
    } catch (error) {
      logger.error(`Error in trackerService.findByNameAndGroup: ${error.message}`);
      throw error;
    }
  },

  /**
   * Find trackers by name (across all groups)
   * @param {string} name - The tracker name
   * @returns {Promise<Array>} Array of tracker documents
   */
  async findByName(name) {
    try {
      const collection = await this.getCollection();
      return await collection.find({ name }).toArray();
    } catch (error) {
      logger.error(`Error in trackerService.findByName: ${error.message}`);
      throw error;
    }
  },

  /**
   * Find a tracker by ID
   * @param {string} id - The tracker ID
   * @returns {Promise<Object|null>} The tracker document or null
   */
  async findById(id) {
    try {
      const collection = await this.getCollection();
      return await collection.findOne({ _id: new ObjectId(id) });
    } catch (error) {
      logger.error(`Error in trackerService.findById: ${error.message}`);
      throw error;
    }
  },

  /**
   * Get all active trackers
   * @returns {Promise<Array>} Array of tracker documents
   */
  async getAllActive() {
    try {
      const collection = await this.getCollection();
      return await collection.find({ active: true }).toArray();
    } catch (error) {
      logger.error(`Error in trackerService.getAllActive: ${error.message}`);
      throw error;
    }
  },

  /**
   * Get all active trackers for a specific group
   * @param {string} groupId - The group ID
   * @returns {Promise<Array>} Array of tracker documents
   */
  async getActiveForGroup(groupId) {
    try {
      const collection = await this.getCollection();
      return await collection.find({ groupId, active: true }).toArray();
    } catch (error) {
      logger.error(`Error in trackerService.getActiveForGroup: ${error.message}`);
      throw error;
    }
  },

  /**
   * Update tracker status
   * @param {string} id - Tracker ID
   * @param {boolean} active - New active status
   * @returns {Promise<Object|null>} Updated tracker or null
   */
  async updateStatus(id, active) {
    try {
      const collection = await this.getCollection();
      const result = await collection.findOneAndUpdate(
        { _id: new ObjectId(id) },
        { $set: { active, updatedAt: new Date() } },
        { returnDocument: 'after' }
      );
      
      return result.value;
    } catch (error) {
      logger.error(`Error in trackerService.updateStatus: ${error.message}`);
      throw error;
    }
  },

  /**
   * Delete a tracker
   * @param {string} name - Tracker name
   * @param {string} groupId - Group ID
   * @returns {Promise<boolean>} Success status
   */
  async delete(name, groupId) {
    try {
      const collection = await this.getCollection();
      const result = await collection.deleteOne({ name, groupId });
      return result.deletedCount > 0;
    } catch (error) {
      logger.error(`Error in trackerService.delete: ${error.message}`);
      return false;
    }
  }
};

module.exports = trackerService;