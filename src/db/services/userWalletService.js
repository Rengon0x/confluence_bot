// src/db/services/userWalletService.js
const { getDatabase } = require('../connection');
const UserWalletModel = require('../models/userWallet');
const logger = require('../../utils/logger');

const userWalletService = {
  async getCollection() {
    const db = await getDatabase();
    return db.collection(UserWalletModel.collectionName);
  },

  /**
   * Add or update a wallet for a user
   * @param {string} userId - Telegram user ID
   * @param {string} username - Telegram username
   * @param {string} walletAddress - Wallet address
   * @param {string} walletLabel - Wallet label/tag
   * @param {string} trackerSource - Source tracker (cielo, defined, ray)
   * @param {string} groupId - Group where this wallet was detected
   */
  async addOrUpdateWallet(userId, username, walletAddress, walletLabel, trackerSource, groupId) {
    try {
      const collection = await this.getCollection();
      
      // Check if user document exists
      const userDoc = await collection.findOne({ userId: userId.toString() });
      
      // Create a unique identifier for the wallet
      // If no address is available, use a hash of label+source
      const walletId = walletAddress || `${trackerSource}_${Buffer.from(walletLabel).toString('base64')}`;
      
      if (!userDoc) {
        // Create new user document
        await collection.insertOne({
          userId: userId.toString(),
          username: username,
          wallets: [{
            id: walletId,
            address: walletAddress,
            label: walletLabel,
            source: trackerSource,
            groupId: groupId,
            firstSeen: new Date(),
            lastSeen: new Date()
          }],
          createdAt: new Date(),
          updatedAt: new Date()
        });
      } else {
        // Check if wallet already exists for this user
        const existingWallet = userDoc.wallets.find(w => 
          (w.address && w.address === walletAddress) || 
          (w.id === walletId)
        );
        
        if (existingWallet) {
          // Update existing wallet's lastSeen and possibly label if changed
          await collection.updateOne(
            { userId: userId.toString(), 'wallets.id': walletId },
            { 
              $set: { 
                'wallets.$.lastSeen': new Date(),
                'wallets.$.label': walletLabel,
                'wallets.$.address': walletAddress || existingWallet.address, // Update address if we found it
                username: username,
                updatedAt: new Date()
              }
            }
          );
        } else {
          // Add new wallet to existing user
          await collection.updateOne(
            { userId: userId.toString() },
            { 
              $push: { 
                wallets: {
                  id: walletId,
                  address: walletAddress,
                  label: walletLabel,
                  source: trackerSource,
                  groupId: groupId,
                  firstSeen: new Date(),
                  lastSeen: new Date()
                }
              },
              $set: { 
                username: username,
                updatedAt: new Date() 
              }
            }
          );
        }
      }
      
      logger.debug(`Added/updated wallet ${walletLabel} (${walletAddress || 'no address'}) for user ${username}`);
      return true;
    } catch (error) {
      logger.error(`Error in userWalletService.addOrUpdateWallet: ${error.message}`);
      return false;
    }
  },

  /**
   * Get all wallets for a user
   * @param {string} userId - Telegram user ID
   * @returns {Promise<Array>} - List of wallets
   */
  async getUserWallets(userId) {
    try {
      const collection = await this.getCollection();
      const userDoc = await collection.findOne({ userId: userId.toString() });
      
      return userDoc ? userDoc.wallets : [];
    } catch (error) {
      logger.error(`Error in userWalletService.getUserWallets: ${error.message}`);
      return [];
    }
  },

  /**
   * Get all wallets for a username
   * @param {string} username - Telegram username
   * @returns {Promise<Array>} - List of wallets
   */
  async getUserWalletsByUsername(username) {
    try {
      const collection = await this.getCollection();
      const userDoc = await collection.findOne({ username: username });
      
      return userDoc ? userDoc.wallets : [];
    } catch (error) {
      logger.error(`Error in userWalletService.getUserWalletsByUsername: ${error.message}`);
      return [];
    }
  }
};

module.exports = userWalletService;