const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

// Define path to the storage file
const storagePath = path.join(__dirname, '../../data');
const storageFile = path.join(storagePath, 'storage.json');

// Ensure the data directory exists
if (!fs.existsSync(storagePath)) {
  fs.mkdirSync(storagePath, { recursive: true });
}

// Initialize storage if it doesn't exist
if (!fs.existsSync(storageFile)) {
  fs.writeFileSync(storageFile, JSON.stringify({
    chats: {}
  }, null, 2));
}

/**
 * Service to handle persistent storage for the bot
 */
const storageService = {
  /**
   * Read data from storage
   * @returns {Object} - The stored data
   */
  read() {
    try {
      const data = fs.readFileSync(storageFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      logger.error('Error reading storage file:', error);
      return { chats: {} };
    }
  },

  /**
   * Write data to storage
   * @param {Object} data - The data to store
   */
  write(data) {
    try {
      fs.writeFileSync(storageFile, JSON.stringify(data, null, 2));
    } catch (error) {
      logger.error('Error writing to storage file:', error);
    }
  },

  /**
   * Register a chat for monitoring
   * @param {string|number} chatId - The chat ID
   * @param {Object} chatInfo - Additional chat information
   */
  registerChat(chatId, chatInfo = {}) {
    const data = this.read();
    
    data.chats[chatId] = {
      ...chatInfo,
      registered: new Date().toISOString()
    };
    
    this.write(data);
    logger.info(`Chat registered: ${chatId}`);
    
    return data.chats[chatId];
  },

  /**
   * Unregister a chat
   * @param {string|number} chatId - The chat ID
   */
  unregisterChat(chatId) {
    const data = this.read();
    
    if (data.chats[chatId]) {
      delete data.chats[chatId];
      this.write(data);
      logger.info(`Chat unregistered: ${chatId}`);
      return true;
    }
    
    return false;
  },

  /**
   * Check if a chat is registered
   * @param {string|number} chatId - The chat ID
   * @returns {boolean} - True if the chat is registered
   */
  isChatRegistered(chatId) {
    const data = this.read();
    return !!data.chats[chatId];
  },

  /**
   * Get all registered chats
   * @returns {Object} - The registered chats
   */
  getRegisteredChats() {
    const data = this.read();
    return data.chats;
  },

  /**
   * Update chat settings
   * @param {string|number} chatId - The chat ID
   * @param {Object} settings - The settings to update
   */
  updateChatSettings(chatId, settings) {
    const data = this.read();
    
    if (data.chats[chatId]) {
      data.chats[chatId] = {
        ...data.chats[chatId],
        ...settings,
        updated: new Date().toISOString()
      };
      
      this.write(data);
      logger.info(`Chat settings updated: ${chatId}`);
      return data.chats[chatId];
    }
    
    return null;
  }
};

module.exports = storageService;