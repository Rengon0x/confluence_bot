// src/services/accessControlService.js
const { getDatabase } = require('../db/connection');
const logger = require('../utils/logger');
const config = require('../config/config');

/**
 * Service for managing user access to the bot
 */
const accessControlService = {
  // Collection name in MongoDB
  collectionName: 'beta_users',
  
  // Maximum number of allowed users (from config or default 100)
  maxUsers: config.accessControl?.maxUsers || 100,

  /**
   * Initialize the access control collection
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      const db = await getDatabase();
      const collection = db.collection(this.collectionName);
      
      // Create indexes
      await collection.createIndex({ username: 1 }, { unique: true });
      await collection.createIndex({ userId: 1 }, { sparse: true });
      
      logger.info('Access control service initialized');
    } catch (error) {
      logger.error(`Error initializing access control: ${error.message}`);
    }
  },

  /**
   * Add a user to the authorized users list
   * @param {string} username - Telegram username (without @)
   * @param {string} addedBy - Admin username who added this user
   * @returns {Promise<Object>} Result of the operation
   */
  async addAuthorizedUser(username, addedBy = 'system') {
    try {
      // Clean the username (remove @ if present)
      username = username.trim().replace(/^@/, '').toLowerCase();
      
      if (!username) {
        return { success: false, message: 'Invalid username' };
      }
      
      const db = await getDatabase();
      const collection = db.collection(this.collectionName);
      
      // Check if the user already exists
      const existingUser = await collection.findOne({ username: username });
      if (existingUser) {
        return { success: false, message: 'User is already authorized' };
      }
      
      // Count current users to check against maximum
      const currentCount = await collection.countDocuments();
      if (currentCount >= this.maxUsers) {
        return { 
          success: false, 
          message: `Maximum number of users (${this.maxUsers}) reached. Remove some users first.` 
        };
      }
      
      // Add the user
      await collection.insertOne({
        username: username,
        addedBy: addedBy,
        addedAt: new Date(),
        active: true
      });
      
      logger.info(`User @${username} added to authorized users by ${addedBy}`);
      return { success: true, message: `User @${username} has been authorized` };
    } catch (error) {
      logger.error(`Error adding authorized user: ${error.message}`);
      return { success: false, message: `Error: ${error.message}` };
    }
  },

  /**
   * Remove a user from the authorized users list
   * @param {string} username - Telegram username (without @)
   * @returns {Promise<Object>} Result of the operation
   */
  async removeAuthorizedUser(username) {
    try {
      // Clean the username
      username = username.trim().replace(/^@/, '').toLowerCase();
      
      if (!username) {
        return { success: false, message: 'Invalid username' };
      }
      
      const db = await getDatabase();
      const collection = db.collection(this.collectionName);
      
      const result = await collection.deleteOne({ username: username });
      
      if (result.deletedCount === 0) {
        return { success: false, message: `User @${username} not found in authorized users` };
      }
      
      logger.info(`User @${username} removed from authorized users`);
      return { success: true, message: `User @${username} has been removed from authorized users` };
    } catch (error) {
      logger.error(`Error removing authorized user: ${error.message}`);
      return { success: false, message: `Error: ${error.message}` };
    }
  },

  /**
   * Check if a user is authorized to use the bot
   * @param {Object} user - Telegram user object
   * @returns {Promise<boolean>} Whether the user is authorized
   */
  async isUserAuthorized(user) {
    try {
      if (!user) return false;
      
      // Admins are always authorized (using user IDs from config)
      if (config.adminUsers && Array.isArray(config.adminUsers)) {
        const userId = user.id.toString();
        if (config.adminUsers.includes(userId)) {
          return true;
        }
      }
      
      const db = await getDatabase();
      const collection = db.collection(this.collectionName);
      
      // First try by userId if available
      if (user.id) {
        const userById = await collection.findOne({ userId: user.id.toString() });
        if (userById && userById.active) {
          return true;
        }
      }
      
      // Then try by username
      if (user.username) {
        const username = user.username.toLowerCase();
        const userByName = await collection.findOne({ username: username });
        
        if (userByName) {
          // If found by username but not by ID, update the record to include the ID
          if (user.id && !userByName.userId) {
            await collection.updateOne(
              { username: username },
              { $set: { userId: user.id.toString() } }
            );
          }
          
          return userByName.active;
        }
      }
      
      return false;
    } catch (error) {
      logger.error(`Error checking user authorization: ${error.message}`);
      // Default to false for safety if there's a database error
      return false;
    }
  },

  /**
   * Get the current number of authorized users
   * @returns {Promise<number>} Count of authorized users
   */
  async getAuthorizedUserCount() {
    try {
      const db = await getDatabase();
      const collection = db.collection(this.collectionName);
      
      return await collection.countDocuments({ active: true });
    } catch (error) {
      logger.error(`Error getting authorized user count: ${error.message}`);
      return 0;
    }
  },

  /**
   * Get the current number of available spots
   * @returns {Promise<number>} Number of available spots
   */
  async getAvailableSpots() {
    const currentUsers = await this.getAuthorizedUserCount();
    return Math.max(0, this.maxUsers - currentUsers);
  },

  /**
   * Get all authorized users
   * @returns {Promise<Array>} List of authorized users
   */
  async getAllAuthorizedUsers() {
    try {
      const db = await getDatabase();
      const collection = db.collection(this.collectionName);
      
      return await collection.find({ active: true }).toArray();
    } catch (error) {
      logger.error(`Error getting all authorized users: ${error.message}`);
      return [];
    }
  },
  
  /**
   * Update user info when they interact with the bot
   * @param {Object} user - Telegram user object
   * @returns {Promise<void>}
   */
  async updateUserInfo(user) {
    if (!user || !user.username) return;
    
    try {
      const db = await getDatabase();
      const collection = db.collection(this.collectionName);
      
      const username = user.username.toLowerCase();
      const existingUser = await collection.findOne({ username: username });
      
      if (existingUser) {
        // Update last seen and ensure userId is set
        await collection.updateOne(
          { username: username },
          { 
            $set: { 
              lastSeen: new Date(),
              userId: user.id.toString(),
              firstName: user.first_name,
              lastName: user.last_name
            } 
          }
        );
      }
    } catch (error) {
      logger.error(`Error updating user info: ${error.message}`);
    }
  }
};

module.exports = accessControlService;