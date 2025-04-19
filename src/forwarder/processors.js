const axios = require('axios');
const logger = require('../utils/logger');
const config = require('../config/config');
const parserService = require('../services/parserService');
const confluenceService = require('../services/confluenceService');
const telegramService = require('../services/telegramService');
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
    
    // Parse the message to extract transaction information
    const transaction = parserService.parseTrackerMessage(message);
    
    // If it's not a buy or sell transaction, ignore
    if (!transaction || (transaction.type !== 'buy' && transaction.type !== 'sell')) {
      logger.debug('Message ignored - not a valid transaction');
      return;
    }
    
    // Keep track of the current token to filter confluences
    const currentToken = transaction.coin;
    const currentTokenAddress = transaction.coinAddress;
    
    logger.info(`Extracted transaction: ${transaction.type.toUpperCase()} ${transaction.amount} ${currentToken}`);
    
    // Process for each group
    for (const group of groups) {
      try {
        // Add the transaction to the confluence detection service with group ID
        await confluenceService.addTransaction(transaction, group.id);
        
        // Check for confluences for this group
        const allConfluences = confluenceService.checkConfluences(group.id);
        
        // Filter to only show confluences related to the current token
        const relevantConfluences = allConfluences.filter(confluence => 
          confluence.coin === currentToken || 
          (currentTokenAddress && confluence.coinAddress === currentTokenAddress)
        );
        
        // Log the filtering
        if (allConfluences.length > relevantConfluences.length) {
          logger.debug(`Filtered ${allConfluences.length} confluences down to ${relevantConfluences.length} relevant to token ${currentToken}`);
        }
        
        // If relevant confluences are detected, send alerts
        if (relevantConfluences && relevantConfluences.length > 0) {
          for (const confluence of relevantConfluences) {
            // Format the message
            const message = telegramService.formatConfluenceMessage(confluence);
            
            // Send the alert via bot
            await sendConfluenceAlert(group.id, message);
            
            logger.info(`Confluence alert sent for ${confluence.coin} in group ${group.id}: ${confluence.wallets.length} wallets`);
          }
        }
      } catch (error) {
        logger.error(`Error processing for group ${group.id}: ${error.message}`);
      }
    }
  } catch (error) {
    logger.error(`Error in processMessage: ${error.message}`);
  }
}

/**
 * Send a confluence alert to a group
 * @param {string} groupId - ID of the group
 * @param {string} message - Message content
 */
async function sendConfluenceAlert(groupId, message) {
  try {
    // Send the message using the bot API
    await axios.post(`https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`, {
      chat_id: groupId,
      text: message,
      parse_mode: 'HTML'
    });
    
    logger.debug(`Alert sent to group: ${groupId}`);
  } catch (error) {
    logger.error(`Error sending alert to group ${groupId}: ${error.message}`);
  }
}

module.exports = {
  processMessage,
  sendConfluenceAlert
};