// src/bot/commands/commandManager.js
const logger = require('../../utils/logger');
const config = require('../../config/config');

/**
 * Class to manage bot commands
 */
class CommandManager {
  constructor() {
    this.commands = new Map();
    this.adminCommands = new Map();
    this.admins = new Set(); // Set of admin IDs
  }

  /**
   * Check if a command is directed at this bot
   * @param {Object} msg - Message object
   * @returns {boolean} - True if the command should be processed
   */
  shouldProcessCommand(msg) {
    if (!msg.text || !msg.text.startsWith('/')) return false;
    
    // Extract command parts
    const commandParts = msg.text.split(' ')[0].split('@');
    const command = commandParts[0];
    const mentionedBot = commandParts[1];
    
    // If no bot is mentioned, process the command
    if (!mentionedBot) return true;
    
    // If a bot is mentioned, only process if it's this bot
    const botUsername = config.telegram.botUsername.replace('@', '');
    return mentionedBot.toLowerCase() === botUsername.toLowerCase();
  }

  /**
   * Add a user command
   * @param {Object} command - Command object
   * @param {string} command.name - Command name (without the /)
   * @param {RegExp} command.regex - Regular expression to match the command
   * @param {Function} command.handler - Command handler function
   * @param {string} command.description - Command description
   */
  addCommand(command) {
    if (!command.name || !command.regex || !command.handler) {
      logger.error('Invalid command format:', command);
      return;
    }

    this.commands.set(command.name, command);
    logger.debug(`Command registered: ${command.name}`);
  }

  /**
   * Add an admin command
   * @param {Object} command - Admin command object
   */
  addAdminCommand(command) {
    if (!command.name || !command.regex || !command.handler) {
      logger.error('Invalid admin command format:', command);
      return;
    }

    this.adminCommands.set(command.name, command);
    logger.debug(`Admin command registered: ${command.name}`);
  }

  /**
   * Add multiple commands at once
   * @param {Array<Object>} commands - Array of commands
   */
  addCommands(commands) {
    commands.forEach(command => this.addCommand(command));
  }

  /**
   * Add multiple admin commands at once
   * @param {Array<Object>} commands - Array of admin commands
   */
  addAdminCommands(commands) {
    commands.forEach(command => this.addAdminCommand(command));
  }

  /**
   * Add a user ID to the admin list
   * @param {string|number} userId - Telegram ID of the admin
   */
  addAdmin(userId) {
    this.admins.add(userId.toString());
  }

  /**
   * Check if a user is an admin
   * @param {string|number} userId - Telegram ID of the user
   * @returns {boolean} True if the user is an admin
   */
  isAdmin(userId) {
    // Use the actual admin check
    const result = this.admins.has(userId.toString());
    logger.info(`Admin check for user ${userId}: ${result ? 'IS ADMIN' : 'NOT ADMIN'}`);
    return result;
  }

  /**
   * Clear all conversation states for a user
   * @param {TelegramBot} bot - Telegram bot instance
   * @param {Object} msg - Message object
   */
  clearConversationStates(bot, msg) {
    if (!msg || !msg.from) return;
    
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const stateKey = `${chatId}_${userId}`;
    
    // Clear setup states
    if (bot.setupStates && bot.setupStates.has(stateKey)) {
      bot.setupStates.delete(stateKey);
      logger.debug(`Setup state cleared for user ${userId} in chat ${chatId}`);
    }
    
    // Clear settings states
    if (bot.settingStates && bot.settingStates.has(stateKey)) {
      bot.settingStates.delete(stateKey);
      logger.debug(`Setting state cleared for user ${userId} in chat ${chatId}`);
    }
    
    // Add other states to clear if needed
  }

  /**
   * Register all commands with the Telegram bot
   * @param {TelegramBot} bot - Telegram bot instance
   */
  registerAll(bot) {
    // Register user commands
    for (const command of this.commands.values()) {
      bot.onText(command.regex, (msg, match) => {
        try {
          // Only process if the command is directed at this bot
          if (!this.shouldProcessCommand(msg)) {
            logger.debug(`Ignoring command ${command.name} directed at another bot`);
            return;
          }
          
          // We don't need to do any auth check here because the middleware will
          // handle it for us at the 'emit' level, before command matching happens
          
          // Clear conversation states before executing a new command
          this.clearConversationStates(bot, msg);
          
          logger.info(`Command ${command.name} executed by user ${msg.from.id}`);
          command.handler(bot, msg, match);
        } catch (error) {
          logger.error(`Error executing command ${command.name}:`, error);
          bot.sendMessage(msg.chat.id, `Error executing command: ${error.message}`);
        }
      });
    }

    // Register admin commands
    for (const command of this.adminCommands.values()) {
      bot.onText(command.regex, (msg, match) => {
        try {
          // Only process if the command is directed at this bot
          if (!this.shouldProcessCommand(msg)) {
            logger.debug(`Ignoring admin command ${command.name} directed at another bot`);
            return;
          }
          
          // Clear conversation states before executing a new command
          this.clearConversationStates(bot, msg);
          
          // Check if the user is an admin
          if (!this.isAdmin(msg.from.id)) {
            bot.sendMessage(msg.chat.id, "Sorry, only admins can use this command.");
            return;
          }

          logger.info(`Admin command ${command.name} executed by user ${msg.from.id}`);
          command.handler(bot, msg, match);
        } catch (error) {
          logger.error(`Error executing admin command ${command.name}:`, error);
          bot.sendMessage(msg.chat.id, `Error executing command: ${error.message}`);
        }
      });
    }
  }
}

module.exports = new CommandManager();