const axios = require('axios');
const logger = require('../utils/logger');
const config = require('../config/config');
const parserService = require('../services/parserService');
const confluenceService = require('../services/confluenceService');
const telegramService = require('../services/telegramService');
const queueManager = require('../services/queueService');
const db = require('../db');

/**
 * Process a message from a tracker
 * @param {string} trackerName - Name of the tracker
 * @param {string} message - Message content
 */
async function processMessage(trackerName, message) {
  try {
    // Handle both string and object message types
    const messageText = typeof message === 'string' ? message : message.text;
    
    // 1. Check the sender username if available
    if (trackerName === config.telegram.botUsername) {
      logger.debug(`Ignoring message from our own bot`);
      return;
    }
        
    // 2. Check for confluence message format (messages that start with 🟢 or 🔴 followed by "CONFLUENCE")
    if (messageText.match(/^[🟢🔴]\s+CONFLUENCE/)) {
      logger.debug(`Ignoring confluence message`);
      return;
    }

    // Get all groups that need this message
    const groups = await db.getGroupsForTracker(trackerName);
    
    if (groups.length === 0) {
      logger.debug(`No groups registered for tracker: ${trackerName}`);
      return;
    }
    
    logger.info(`Processing message from ${trackerName} for ${groups.length} groups`);
    
    // Log entity data for debugging - since entities appear to be undefined
    if (message.entities) {
      logger.debug(`Message entity types: ${JSON.stringify(message.entities)}`);
    }
    
    // Process for each group
     // Process for each group
     for (const group of groups) {
      try {
        // Parse the message using the appropriate parser
        const trackerType = group.trackerType || 'cielo';
        const transaction = parserService.parseTrackerMessage(message, trackerType);
        
        // If it's not a buy or sell transaction, ignore
        if (!transaction || (transaction.type !== 'buy' && transaction.type !== 'sell')) {
          logger.debug(`Message ignored - not a valid transaction for tracker type ${trackerType}`);
          continue;
        }
        
        // NEW CODE: Register the wallet for the user who set up this tracker
        try {
          // Get the setup information for this tracker in this group
          const trackerWithSetupInfo = await db.trackerService.findByNameAndGroup(trackerName, group.id);
          
          if (trackerWithSetupInfo && trackerWithSetupInfo.setupUserId && trackerWithSetupInfo.setupUsername) {
            // Register this wallet for the user who set up the tracker
            await userWalletService.addOrUpdateWallet(
              trackerWithSetupInfo.setupUserId,
              trackerWithSetupInfo.setupUsername,
              transaction.walletAddress,
              transaction.coinAddress || transaction.walletName, // Use address if available, otherwise use name
              transaction.walletName, // The label/tag of the wallet
              trackerType,
              group.id
            );
          }
        } catch (walletError) {
          logger.error(`Error registering wallet: ${walletError.message}`);
          // Continue processing even if wallet registration fails
        }
        
        // Keep track of the current token to filter confluences
        const currentToken = transaction.coin;
        const currentTokenAddress = transaction.coinAddress;
        
        logger.info(`Extracted transaction from ${trackerType} tracker: ${transaction.type.toUpperCase()} ${transaction.amount} ${currentToken}`);
        
        // Create an extended transaction with token filtering info for confluence detection
        const queuedTransaction = {
          ...transaction,
          // Add metadata for confluence filtering
          _meta: {
            trackerName,
            trackerType,
            currentToken,
            currentTokenAddress,
            // Store queue timestamp for analytics
            queuedAt: Date.now()
          }
        };
        
        // Add the transaction to the group-specific queue
        await queueManager.addTransaction(queuedTransaction, group.id);
        
        logger.debug(`Queued transaction for group ${group.id}: ${transaction.type} ${transaction.amount} ${currentToken}`);
      } catch (error) {
        logger.error(`Error processing message for group ${group.id}: ${error.message}`);
      }
    }
  } catch (error) {
    logger.error(`Error in processMessage: ${error.message}`);
  }
}

module.exports = {
  processMessage
};