const { NewMessage } = require('telegram/events');
const logger = require('../utils/logger');
const { getClient } = require('./client');
const { monitoredTrackers } = require('./utils');
const { processMessage } = require('./processors');

/**
 * Set up the global message handler
 */
function setupMessageHandler() {
  const client = getClient();
  
  client.addEventHandler(async (event) => {
    try {
      const message = event.message;
      
      // Don't process messages from the bot itself or empty messages
      if (message.out || !message.text) return;
      
      // Try different ways to get sender information
      const senderId = message.senderId || (message.sender ? message.sender.id : null);
      const senderUsername = message.sender ? message.sender.username : null;
      
      // Log details about the received message
      logger.debug(`Received message. Sender ID: ${senderId}, Username: ${senderUsername}`);
      logger.debug(`Message content: ${message.text.substring(0, 100)}...`);
      
      // Check if this message is from a monitored tracker
      for (const [trackerName, tracker] of monitoredTrackers.entries()) {
        // Compare ID or username
        if (tracker.entity.id === senderId || 
            tracker.entity.username === senderUsername ||
            (tracker.entity.username && senderUsername && 
             tracker.entity.username.toLowerCase() === senderUsername.toLowerCase()) ||
            String(tracker.entity.id) === String(senderId)) {
          
          logger.info(`Matched message from tracked source: ${trackerName}`);
          await processMessage(trackerName, message.text);
          break;
        }
      }
    } catch (error) {
      logger.error(`Error in global message handler: ${error.message}`, error);
    }
  }, new NewMessage({}));
  
  logger.info('Global message handler set up');
}

module.exports = {
  setupMessageHandler
};