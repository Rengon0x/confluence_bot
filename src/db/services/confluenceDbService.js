// src/db/services/confluenceDbService.js
const { getDatabase } = require('../connection');
const ConfluenceModel = require('../models/confluence');
const logger = require('../../utils/logger');
const performanceMonitor = require('../../utils/performanceMonitor');

// Cached collection reference to avoid repeated lookups
let cachedCollection = null;

/**
 * Service for handling confluence database operations
 * This manages the persistence of confluence data to avoid recalculating from scratch
 */
const confluenceDbService = {
  /**
   * Get the confluences collection with caching
   * @returns {Promise<Collection>} The confluences collection
   */
  async getCollection() {
    if (cachedCollection) {
      return cachedCollection;
    }
    
    const db = await getDatabase();
    cachedCollection = db.collection(ConfluenceModel.collectionName);
    return cachedCollection;
  },

  /**
   * Find an existing confluence by token
   * @param {string} groupId - Group ID
   * @param {string} tokenAddress - Token address (optional)
   * @param {string} tokenSymbol - Token symbol (optional if address provided)
   * @returns {Promise<Object|null>} The confluence or null if not found
   */
  async findConfluence(groupId, tokenAddress, tokenSymbol) {
    try {
      // Start measuring performance
      const timer = performanceMonitor.startTimer();
      
      const collection = await this.getCollection();
      
      // Build query based on available parameters
      const query = { 
        groupId,
        isActive: true
      };
      
      // Use token address for lookup when available (more reliable)
      if (tokenAddress) {
        query.tokenAddress = tokenAddress;
      } else if (tokenSymbol) {
        query.tokenSymbol = tokenSymbol;
      } else {
        return null; // Need at least one identifier
      }
      
      // Use appropriate index hint for better performance
      const indexHint = tokenAddress ? 
        { groupId: 1, tokenAddress: 1 } : 
        { groupId: 1, tokenSymbol: 1 };
      
      const result = await collection.findOne(query, { hint: indexHint });
      
      // End performance measurement
      const opName = tokenAddress ? 
        `find_confluence_by_address_${groupId}` : 
        `find_confluence_by_symbol_${groupId}`;
      performanceMonitor.endTimer(timer, 'mongoQueries', opName);
      
      return result;
    } catch (error) {
      // If hint fails, retry without hint
      if (error.message.includes('hint') || error.message.includes('index')) {
        logger.warn(`Index hint failed in findConfluence: ${error.message}`);
        
        try {
          const collection = await this.getCollection();
          
          // Build query without hint
          const query = { 
            groupId,
            isActive: true
          };
          
          if (tokenAddress) {
            query.tokenAddress = tokenAddress;
          } else if (tokenSymbol) {
            query.tokenSymbol = tokenSymbol;
          }
          
          return await collection.findOne(query);
        } catch (fallbackError) {
          logger.error(`Fallback error in findConfluence: ${fallbackError.message}`);
          return null;
        }
      }
      
      logger.error(`Error in confluenceDbService.findConfluence: ${error.message}`);
      return null;
    }
  },

  /**
   * Store a new confluence or update an existing one
   * @param {Object} confluence - Confluence data
   * @returns {Promise<Object>} The stored confluence
   */
  async storeConfluence(confluence) {
    try {
      const timer = performanceMonitor.startTimer();
      const collection = await this.getCollection();
      
      // Extract required fields
      const { 
        groupId, 
        coin: tokenSymbol, 
        coinAddress: tokenAddress,
        type,
        wallets,
        count,
        nonMetadataCount,
        totalAmount,
        totalUsdValue,
        totalBaseAmount,
        avgMarketCap,
        timestamp,
        isUpdate,
        buyCount,
        sellCount,
        is48hWindow
      } = confluence;
      
      // Create a query to find existing confluence
      const query = { groupId };
      
      if (tokenAddress) {
        query.tokenAddress = tokenAddress;
      } else {
        query.tokenSymbol = tokenSymbol;
      }
      
      // Try to find existing confluence
      const existingConfluence = await collection.findOne(query);
      
      if (existingConfluence) {
        // Update existing confluence
        const result = await collection.updateOne(
          { _id: existingConfluence._id },
          { 
            $set: {
              type,
              wallets,
              count,
              nonMetadataCount,
              totalAmount,
              totalUsdValue,
              totalBaseAmount,
              avgMarketCap,
              lastUpdated: new Date(),
              isUpdate: true,
              buyCount,
              sellCount,
              is48hWindow,
              isActive: true
            } 
          }
        );
        
        if (result.modifiedCount > 0) {
          logger.debug(`Updated confluence for ${tokenSymbol || tokenAddress} in group ${groupId}`);
        }
        
        // Record performance
        performanceMonitor.endTimer(timer, 'mongoQueries', `update_confluence_${groupId}`);
        
        // Return the updated confluence
        return {
          ...existingConfluence,
          type,
          wallets,
          count,
          nonMetadataCount,
          totalAmount,
          totalUsdValue,
          totalBaseAmount,
          avgMarketCap,
          lastUpdated: new Date(),
          isUpdate: true,
          buyCount,
          sellCount,
          is48hWindow
        };
      } else {
        // Create a new confluence document
        const confluenceDoc = {
          groupId,
          tokenAddress,
          tokenSymbol,
          type,
          wallets,
          count,
          nonMetadataCount,
          totalAmount,
          totalUsdValue,
          totalBaseAmount,
          avgMarketCap,
          timestamp: new Date(timestamp),
          lastUpdated: new Date(),
          isUpdate,
          buyCount,
          sellCount,
          is48hWindow,
          isActive: true
        };
        
        const result = await collection.insertOne(confluenceDoc);
        logger.debug(`Created new confluence for ${tokenSymbol || tokenAddress} in group ${groupId}`);
        
        // Record performance
        performanceMonitor.endTimer(timer, 'mongoQueries', `create_confluence_${groupId}`);
        
        return { 
          ...confluenceDoc, 
          _id: result.insertedId 
        };
      }
    } catch (error) {
      logger.error(`Error in confluenceDbService.storeConfluence: ${error.message}`);
      throw error;
    }
  },

  /**
   * Get recent confluences for a group
   * @param {string} groupId - Group ID
   * @param {number} limit - Maximum number of confluences to return
   * @returns {Promise<Array>} Recent confluences
   */
  async getRecentConfluences(groupId, limit = 20) {
    try {
      const collection = await this.getCollection();
      
      // Find active confluences for this group with index hint
      return await collection.find({ 
        groupId, 
        isActive: true 
      })
      .hint({ groupId: 1, lastUpdated: -1 })
      .sort({ lastUpdated: -1 })
      .limit(limit)
      .toArray();
    } catch (error) {
      // Fallback if hint fails
      if (error.message.includes('hint')) {
        try {
          const collection = await this.getCollection();
          
          return await collection.find({ 
            groupId, 
            isActive: true 
          })
          .sort({ lastUpdated: -1 })
          .limit(limit)
          .toArray();
        } catch (fallbackError) {
          logger.error(`Fallback error in getRecentConfluences: ${fallbackError.message}`);
          return [];
        }
      }
      
      logger.error(`Error in confluenceDbService.getRecentConfluences: ${error.message}`);
      return [];
    }
  },

  /**
   * Get all confluences for a group within a timeframe
   * @param {string} groupId - Group ID
   * @param {Date} cutoffTime - Cutoff timestamp
   * @returns {Promise<Array>} - List of confluences
   */
  async getConfluencesInTimeframe(groupId, cutoffTime) {
    try {
      const collection = await this.getCollection();
      
      return await collection.find({
        groupId,
        $or: [
          { timestamp: { $gte: cutoffTime } },
          { lastUpdated: { $gte: cutoffTime } }
        ]
      })
      .sort({ timestamp: -1 })
      .toArray();
    } catch (error) {
      logger.error(`Error in confluenceDbService.getConfluencesInTimeframe: ${error.message}`);
      return [];
    }
  },

  /**
   * Deactivate old confluences
   * @param {number} maxHours - Maximum age in hours
   * @returns {Promise<number>} Number of deactivated confluences
   */
  async deactivateOldConfluences(maxHours = 48) {
    try {
      const collection = await this.getCollection();
      
      const cutoffTime = new Date(Date.now() - (maxHours * 60 * 60 * 1000));
      
      const result = await collection.updateMany(
        { lastUpdated: { $lt: cutoffTime }, isActive: true },
        { $set: { isActive: false } }
      );
      
      if (result.modifiedCount > 0) {
        logger.info(`Deactivated ${result.modifiedCount} old confluences`);
      }
      
      return result.modifiedCount;
    } catch (error) {
      logger.error(`Error in confluenceDbService.deactivateOldConfluences: ${error.message}`);
      return 0;
    }
  },

  /**
   * Get confluence statistics for analysis
   * @returns {Promise<Object>} Statistics about confluences
   */
  async getConfluenceStats() {
    try {
      const collection = await this.getCollection();
      
      // Count total confluences
      const totalCount = await collection.countDocuments();
      
      // Count active confluences
      const activeCount = await collection.countDocuments({ isActive: true });
      
      // Get counts by group
      const groupStats = await collection.aggregate([
        { $group: { 
            _id: "$groupId", 
            count: { $sum: 1 },
            activeCount: { 
              $sum: { $cond: [{ $eq: ["$isActive", true] }, 1, 0] } 
            }
          } 
        },
        { $sort: { count: -1 } }
      ]).toArray();
      
      // Calculate average wallets per confluence
      const avgResult = await collection.aggregate([
        { $group: {
            _id: null,
            avgWallets: { $avg: "$count" }
          }
        }
      ]).toArray();
      
      const avgWallets = avgResult.length > 0 ? avgResult[0].avgWallets : 0;
      
      return {
        totalCount,
        activeCount,
        groupStats,
        avgWallets
      };
    } catch (error) {
      logger.error(`Error in confluenceDbService.getConfluenceStats: ${error.message}`);
      return {
        totalCount: 0,
        activeCount: 0,
        groupStats: [],
        avgWallets: 0
      };
    }
  },

  /**
   * Check if a specific token has an active confluence in a group
   * Used for quick checks without loading full confluence data
   * @param {string} groupId - Group ID
   * @param {string} tokenAddress - Token address (optional)
   * @param {string} tokenSymbol - Token symbol (optional if address provided)
   * @returns {Promise<boolean>} Whether the token has an active confluence
   */
  async hasActiveConfluence(groupId, tokenAddress, tokenSymbol) {
    try {
      const collection = await this.getCollection();
      
      // Build query based on available parameters
      const query = { 
        groupId,
        isActive: true
      };
      
      if (tokenAddress) {
        query.tokenAddress = tokenAddress;
      } else if (tokenSymbol) {
        query.tokenSymbol = tokenSymbol;
      } else {
        return false; // Need at least one identifier
      }
      
      // Use count instead of findOne for better performance
      const count = await collection.countDocuments(query, { limit: 1 });
      return count > 0;
    } catch (error) {
      logger.error(`Error in confluenceDbService.hasActiveConfluence: ${error.message}`);
      return false;
    }
  },

  /**
   * Delete confluences for a specific group
   * Used when removing a group from the system
   * @param {string} groupId - Group ID
   * @returns {Promise<number>} Number of confluences deleted
   */
  async deleteGroupConfluences(groupId) {
    try {
      const collection = await this.getCollection();
      
      const result = await collection.deleteMany({ groupId });
      
      if (result.deletedCount > 0) {
        logger.info(`Deleted ${result.deletedCount} confluences for group ${groupId}`);
      }
      
      return result.deletedCount;
    } catch (error) {
      logger.error(`Error in confluenceDbService.deleteGroupConfluences: ${error.message}`);
      return 0;
    }
  },

  /**
   * Add a new wallet to an existing confluence
   * For incremental updates without reconstructing the entire confluence
   * @param {string} groupId - Group ID
   * @param {string} tokenAddress - Token address
   * @param {string} tokenSymbol - Token symbol
   * @param {Object} wallet - Wallet data to add
   * @returns {Promise<boolean>} Success status
   */
  async addWalletToConfluence(groupId, tokenAddress, tokenSymbol, wallet) {
    try {
      const timer = performanceMonitor.startTimer();
      const collection = await this.getCollection();
      
      // Build query to find the confluence
      const query = { groupId, isActive: true };
      
      if (tokenAddress) {
        query.tokenAddress = tokenAddress;
      } else if (tokenSymbol) {
        query.tokenSymbol = tokenSymbol;
      } else {
        return false; // Need at least one identifier
      }
      
      // Add wallet to the confluence and update metrics
      const result = await collection.updateOne(
        query,
        { 
          $push: { wallets: wallet },
          $inc: { 
            count: 1,
            nonMetadataCount: wallet.isFromMetadata ? 0 : 1,
            totalAmount: wallet.amount || 0,
            totalUsdValue: wallet.usdValue || 0,
            totalBaseAmount: wallet.baseAmount || 0,
            buyCount: wallet.type === 'buy' ? 1 : 0,
            sellCount: wallet.type === 'sell' ? 1 : 0
          },
          $set: {
            lastUpdated: new Date(),
            isUpdate: true
          }
        }
      );
      
      // Record performance
      performanceMonitor.endTimer(timer, 'mongoQueries', `add_wallet_to_confluence_${groupId}`);
      
      return result.modifiedCount > 0;
    } catch (error) {
      logger.error(`Error in confluenceDbService.addWalletToConfluence: ${error.message}`);
      return false;
    }
  },
  
  /**
   * Update an existing wallet in a confluence
   * For when a wallet already exists but gets a transaction of a different type
   * @param {string} groupId - Group ID
   * @param {string} tokenAddress - Token address
   * @param {string} tokenSymbol - Token symbol
   * @param {string} walletId - Wallet identifier (name or address)
   * @param {Object} updates - Updates to apply to the wallet
   * @returns {Promise<boolean>} Success status
   */
  async updateWalletInConfluence(groupId, tokenAddress, tokenSymbol, walletId, updates) {
    try {
      const timer = performanceMonitor.startTimer();
      const collection = await this.getCollection();
      
      // Build query to find the confluence
      const query = { groupId, isActive: true };
      
      if (tokenAddress) {
        query.tokenAddress = tokenAddress;
      } else if (tokenSymbol) {
        query.tokenSymbol = tokenSymbol;
      } else {
        return false;
      }
      
      // Add condition to match the specific wallet
      if (walletId.includes('.')) {
        // This is a wallet address - need to escape the dot for MongoDB
        walletId = walletId.replace('.', '\\.');
      }
      
      // Find and update the specific wallet within the confluence
      // We'll search by both wallet address and name to be sure
      const updateQuery = {
        $set: {
          "wallets.$[wallet].isUpdated": true,
          "wallets.$[wallet].type": updates.type,
          lastUpdated: new Date(),
          isUpdate: true
        }
      };
      
      // Add incremental updates for each value
      if (updates.amount) {
        updateQuery.$inc = updateQuery.$inc || {};
        updateQuery.$inc["wallets.$[wallet].amount"] = updates.amount;
      }
      
      if (updates.usdValue) {
        updateQuery.$inc = updateQuery.$inc || {};
        updateQuery.$inc["wallets.$[wallet].usdValue"] = updates.usdValue;
      }
      
      if (updates.baseAmount) {
        updateQuery.$inc = updateQuery.$inc || {};
        updateQuery.$inc["wallets.$[wallet].baseAmount"] = updates.baseAmount;
      }
      
      // Handle type-specific amounts
      if (updates.type === 'buy') {
        updateQuery.$inc = updateQuery.$inc || {};
        updateQuery.$inc["wallets.$[wallet].buyAmount"] = updates.amount || 0;
        updateQuery.$inc["wallets.$[wallet].buyBaseAmount"] = updates.baseAmount || 0;
        updateQuery.$inc = { ...updateQuery.$inc, buyCount: 1 };
      } else if (updates.type === 'sell') {
        updateQuery.$inc = updateQuery.$inc || {};
        updateQuery.$inc["wallets.$[wallet].sellAmount"] = updates.amount || 0;
        updateQuery.$inc["wallets.$[wallet].sellBaseAmount"] = updates.baseAmount || 0;
        updateQuery.$inc = { ...updateQuery.$inc, sellCount: 1 };
      }
      
      // Apply total increments to the confluence itself
      if (updates.amount) {
        updateQuery.$inc = updateQuery.$inc || {};
        updateQuery.$inc.totalAmount = updates.amount;
      }
      
      if (updates.usdValue) {
        updateQuery.$inc = updateQuery.$inc || {};
        updateQuery.$inc.totalUsdValue = updates.usdValue;
      }
      
      if (updates.baseAmount) {
        updateQuery.$inc = updateQuery.$inc || {};
        updateQuery.$inc.totalBaseAmount = updates.baseAmount;
      }
      
      // Update the array element that matches either walletName or walletAddress
      const arrayFilters = [{
        $or: [
          { "wallet.walletName": walletId },
          { "wallet.walletAddress": walletId }
        ]
      }];
      
      const result = await collection.updateOne(
        query,
        updateQuery,
        { arrayFilters }
      );
      
      // Record performance
      performanceMonitor.endTimer(timer, 'mongoQueries', `update_wallet_in_confluence_${groupId}`);
      
      return result.modifiedCount > 0;
    } catch (error) {
      logger.error(`Error in confluenceDbService.updateWalletInConfluence: ${error.message}`);
      return false;
    }
  },
  
  /**
   * Recalculate the primary type for a confluence based on the current wallet counts
   * @param {string} groupId - Group ID
   * @param {string} tokenAddress - Token address
   * @param {string} tokenSymbol - Token symbol
   * @returns {Promise<boolean>} Success status
   */
  async recalculatePrimaryType(groupId, tokenAddress, tokenSymbol) {
    try {
      const collection = await this.getCollection();
      
      // Find the confluence
      const query = { groupId, isActive: true };
      
      if (tokenAddress) {
        query.tokenAddress = tokenAddress;
      } else if (tokenSymbol) {
        query.tokenSymbol = tokenSymbol;
      } else {
        return false;
      }
      
      const confluence = await collection.findOne(query);
      if (!confluence) return false;
      
      // Count buy vs sell wallets
      let buyCount = 0;
      let sellCount = 0;
      
      for (const wallet of confluence.wallets) {
        if (wallet.type === 'buy') buyCount++;
        if (wallet.type === 'sell') sellCount++;
      }
      
      // Determine primary type
      const primaryType = buyCount >= sellCount ? 'buy' : 'sell';
      
      // Update if different
      if (primaryType !== confluence.type) {
        await collection.updateOne(
          query,
          { 
            $set: { 
              type: primaryType,
              buyCount,
              sellCount,
              lastUpdated: new Date()
            }
          }
        );
      }
      
      return true;
    } catch (error) {
      logger.error(`Error in confluenceDbService.recalculatePrimaryType: ${error.message}`);
      return false;
    }
  },

  /**
   * Get first detected confluence for each token in a group
   * Used for historical analysis
   * @param {string} groupId - Group ID
   * @param {number} lookbackHours - Number of hours to look back
   * @returns {Promise<Array>} First confluences per token
   */
  async getFirstConfluencesPerToken(groupId, lookbackHours = 48) {
    try {
      const collection = await this.getCollection();
      
      const cutoffTime = new Date(Date.now() - (lookbackHours * 60 * 60 * 1000));
      
      // First, get all tokens that have confluences in this time period
      const tokens = await collection.aggregate([
        {
          $match: { 
            groupId, 
            timestamp: { $gte: cutoffTime } 
          }
        },
        {
          $sort: { timestamp: 1 } // Sort by earliest first
        },
        {
          $group: {
            _id: { 
              tokenAddress: "$tokenAddress", 
              tokenSymbol: "$tokenSymbol" 
            },
            firstConfluenceId: { $first: "$_id" }
          }
        }
      ]).toArray();
      
      // Now fetch the actual confluence documents
      const confluences = [];
      
      for (const token of tokens) {
        const confluence = await collection.findOne({ _id: token.firstConfluenceId });
        if (confluence) {
          confluences.push(confluence);
        }
      }
      
      return confluences;
    } catch (error) {
      logger.error(`Error in confluenceDbService.getFirstConfluencesPerToken: ${error.message}`);
      return [];
    }
  }
};

module.exports = confluenceDbService;