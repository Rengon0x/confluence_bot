// src/forwarder/messageHandler.js
const { NewMessage } = require('telegram/events');
const logger = require('../utils/logger');
const { getAllClients } = require('./clientPool');
const { monitoredTrackers } = require('./utils');
const { processMessage } = require('./processors');

/**
 * Set up the global message handler
 */
function setupMessageHandler() {
  const clients = getAllClients();
  
  if (clients.size === 0) {
    logger.error('No clients available for message handling');
    return;
  }
  
  logger.info(`Setting up message handlers for ${clients.size} clients`);
  
  // Set up handler for each client
  for (const [clientId, client] of clients.entries()) {
    client.addEventHandler(async (event) => {
      try {
        const message = event.message;
        
        // Don't process messages from the bot itself or empty messages
        if (message.out || !message.text) return;
        
        // Preserve the original message entities
        const messageWithEntities = {
          text: message.text,
          entities: message.entities || []
        };
        
        // Try different ways to get sender information
        const senderId = message.senderId || (message.sender ? message.sender.id : null);
        const senderUsername = message.sender ? message.sender.username : null;
        
        // Log details about the received message
        logger.debug(`[${clientId}] Received message. Sender ID: ${senderId}, Username: ${senderUsername}`);
        logger.debug(`[${clientId}] Message content: ${message.text.substring(0, 100)}...`);
        
        // Check if this message is from a monitored tracker
        for (const [trackerName, tracker] of monitoredTrackers.entries()) {
          // Compare ID or username
          if (tracker.entity.id === senderId || 
              tracker.entity.username === senderUsername ||
              (tracker.entity.username && senderUsername && 
               tracker.entity.username.toLowerCase() === senderUsername.toLowerCase()) ||
              String(tracker.entity.id) === String(senderId)) {
            
            logger.info(`[${clientId}] Matched message from tracked source: ${trackerName}`);
            // Pass the message with entities instead of just the text
            await processMessage(trackerName, messageWithEntities);
            break;
          }
        }
      } catch (error) {
        logger.error(`[${clientId}] Error in message handler: ${error.message}`, error);
      }
    }, new NewMessage({}));
    
    logger.info(`[${clientId}] Message handler set up`);
  }
  
  logger.info('All message handlers set up');
}

async function processMessageWithFailover(trackerName, messageWithEntities) {
  try {
    // First, try with the primary forwarder (forwarder1)
    let client = getClientForTracker(trackerName);
    
    try {
      // Attempt to process with the selected client
      await processMessage(trackerName, messageWithEntities);
      return true;
    } catch (error) {
      logger.error(`Error with primary forwarder: ${error.message}`);
      
      // If forwarder1 fails, try with forwarder2
      if (clients.has('forwarder2') && client !== clients.get('forwarder2')) {
        try {
          client = clients.get('forwarder2');
          await processMessage(trackerName, messageWithEntities);
          return true;
        } catch (backupError) {
          logger.error(`Error with backup forwarder: ${backupError.message}`);
        }
      }
    }
    
    return false;
  } catch (error) {
    logger.error(`Failed to process message with failover: ${error.message}`);
    return false;
  }
}

module.exports = {
  setupMessageHandler,
  processMessageWithFailover
};