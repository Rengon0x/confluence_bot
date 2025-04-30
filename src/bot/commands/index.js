// src/bot/commands/index.js
const commandManager = require('./commandManager');
const userCommands = require('./user');
const adminCommands = require('./admin');
const config = require('../../config/config');
const logger = require('../../utils/logger');

/**
 * Initialize and register all commands with the bot
 * @param {TelegramBot} bot - Telegram bot instance
 */
function registerCommands(bot) {
  logger.info('Initializing bot commands...');

  // Add all user commands
  commandManager.addCommands(userCommands);

  // Add all admin commands
  commandManager.addAdminCommands(adminCommands);

  // Add configured admins
  if (config.adminUsers && Array.isArray(config.adminUsers)) {
    logger.info(`Adding ${config.adminUsers.length} admins from config: ${config.adminUsers.join(', ')}`);
    config.adminUsers.forEach(userId => {
      commandManager.addAdmin(userId);
    });
  } else {
    logger.warn('No admin users found in config');
  }

  // Register all commands on the bot
  commandManager.registerAll(bot);

  logger.info(`Registered ${userCommands.length} user commands and ${adminCommands.length} admin commands`);
}

module.exports = registerCommands;