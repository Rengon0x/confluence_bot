// src/db/services/betaUserService.js
const { getDatabase } = require('../connection');
const BetaUserModel = require('../models/betaUser');
const logger = require('../../utils/logger');
const config = require('../../config/config');

/**
 * Service for handling beta user database operations
 */
const betaUserService = {
  /**
   * Get the beta users collection
   * @returns {Promise<Collection>} The beta users collection
   */
  async getCollection() {
    const db = await getDatabase();
    return db.collection(BetaUserModel.collectionName);
  },

  /**
   * Initialize the beta users service
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      const collection = await this.getCollection();
      
      // Create indexes
      for (const index of BetaUserModel.indexes) {
        try {
          await collection.createIndex(index.key, { 
            unique: index.unique || false,
            sparse: index.sparse || false,
            background: true
          });
        } catch (indexErr) {
          logger.warn(`Error creating index for beta users: ${indexErr.message}`);
        }
      }
      
      logger.info('Beta users service initialized');
    } catch (error) {
      logger.error(`Error initializing beta users service: ${error.message}`);
    }
  },

  /**
   * Add a user to the authorized beta users list
   * @param {string} username - Telegram username (without @)
   * @param {string} addedBy - Admin username who added this user
   * @returns {Promise<Object>} Result of the operation
   */
  async addBetaUser(username, addedBy = 'system') {
    try {
      // Clean the username (remove @ if present)
      username = username.trim().replace(/^@/, '').toLowerCase();
      
      if (!username) {
        return { success: false, message: 'Invalid username' };
      }
      
      const collection = await this.getCollection();
      
      // Check if the user already exists
      const existingUser = await collection.findOne({ username: username });
      if (existingUser) {
        // If user exists but is not active, reactivate
        if (!existingUser.active) {
          await collection.updateOne(
            { username: username },
            { $set: { active: true, addedBy: addedBy, updatedAt: new Date() } }
          );
          return { success: true, message: `User @${username} has been reactivated` };
        }
        return { success: false, message: 'User is already authorized' };
      }
      
      // Get max users from config
      const maxUsers = config.accessControl?.maxUsers || 100;
      
      // Count current users to check against maximum
      const currentCount = await collection.countDocuments({ active: true });
      if (currentCount >= maxUsers) {
        return { 
          success: false, 
          message: `Maximum number of users (${maxUsers}) reached. Remove some users first.` 
        };
      }
      
      // Add the user
      await collection.insertOne({
        username: username,
        addedBy: addedBy,
        addedAt: new Date(),
        updatedAt: new Date(),
        active: true
      });
      
      logger.info(`User @${username} added to beta users by ${addedBy}`);
      return { success: true, message: `User @${username} has been authorized` };
    } catch (error) {
      logger.error(`Error adding beta user: ${error.message}`);
      return { success: false, message: `Error: ${error.message}` };
    }
  },

  /**
   * Remove a user from the authorized beta users list
   * @param {string} username - Telegram username (without @)
   * @returns {Promise<Object>} Result of the operation
   */
  async removeBetaUser(username) {
    try {
      // Clean the username
      username = username.trim().replace(/^@/, '').toLowerCase();
      
      if (!username) {
        return { success: false, message: 'Invalid username' };
      }
      
      const collection = await this.getCollection();
      
      // Option 1: Delete the user completely
      // const result = await collection.deleteOne({ username: username });
      
      // Option 2: Mark the user as inactive (better for history)
      const result = await collection.updateOne(
        { username: username },
        { $set: { active: false, updatedAt: new Date() } }
      );
      
      if (result.matchedCount === 0) {
        return { success: false, message: `User @${username} not found in beta users` };
      }
      
      logger.info(`User @${username} removed from beta users`);
      return { success: true, message: `User @${username} has been removed from beta users` };
    } catch (error) {
      logger.error(`Error removing beta user: ${error.message}`);
      return { success: false, message: `Error: ${error.message}` };
    }
  },

  /**
   * Check if a user is authorized for the beta
   * @param {Object} user - Telegram user object
   * @returns {Promise<boolean>} Whether the user is authorized
   */
  async isUserAuthorized(user) {
    try {
      if (!user) {
        logger.warn('isUserAuthorized called with null user');
        return false;
      }
      
      logger.info(`Auth check for user: @${user.username || 'unknown'} (${user.id})`);
      
      // Admins are always authorized (using user IDs from config)
      if (config.adminUsers && Array.isArray(config.adminUsers)) {
        const userId = user.id.toString();
        if (config.adminUsers.includes(userId)) {
          logger.info(`User ${user.id} is an admin - authorizing`);
          return true;
        }
      }
      
      const collection = await this.getCollection();
      
      // First try by userId if available
      if (user.id) {
        const userById = await collection.findOne({ 
          userId: user.id.toString(),
          active: true
        });
        
        if (userById) {
          logger.info(`User ${user.id} found by ID in beta users`);
          return true;
        }
      }
      
      // Then try by username
      if (user.username) {
        const username = user.username.toLowerCase();
        logger.info(`Looking up user by username: ${username}`);
        
        const userByName = await collection.findOne({ 
          username: username,
          active: true
        });
        
        if (userByName) {
          logger.info(`User ${username} found by username in beta users`);
          
          // If found by username but not by ID, update the record to include the ID
          if (user.id && !userByName.userId) {
            await collection.updateOne(
              { username: username },
              { 
                $set: { 
                  userId: user.id.toString(),
                  firstName: user.first_name,
                  lastName: user.last_name,
                  updatedAt: new Date()
                } 
              }
            );
            logger.info(`Updated user record for ${username} with ID ${user.id}`);
          }
          
          return true;
        }
      }
      
      logger.info(`User @${user.username || 'unknown'} (${user.id}) is NOT authorized`);
      return false;
    } catch (error) {
      logger.error(`Error checking user authorization: ${error.message}`);
      // Default to false for safety if there's a database error
      return false;
    }
  },

  /**
   * Get the current number of authorized beta users
   * @returns {Promise<number>} Count of authorized users
   */
  async getBetaUserCount() {
    try {
      const collection = await this.getCollection();
      return await collection.countDocuments({ active: true });
    } catch (error) {
      logger.error(`Error getting beta user count: ${error.message}`);
      return 0;
    }
  },

  /**
   * Get the current number of available spots
   * @returns {Promise<number>} Number of available spots
   */
  async getAvailableSpots() {
    const maxUsers = config.accessControl?.maxUsers || 100;
    const currentUsers = await this.getBetaUserCount();
    return Math.max(0, maxUsers - currentUsers);
  },

  /**
   * Get all authorized beta users
   * @returns {Promise<Array>} List of authorized users
   */
  async getAllBetaUsers() {
    try {
      const collection = await this.getCollection();
      return await collection.find({ active: true }).toArray();
    } catch (error) {
      logger.error(`Error getting all beta users: ${error.message}`);
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
      const collection = await this.getCollection();
      
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
              lastName: user.last_name,
              updatedAt: new Date()
            } 
          }
        );
      }
    } catch (error) {
      logger.error(`Error updating user info: ${error.message}`);
    }
  }
};

module.exports = betaUserService;