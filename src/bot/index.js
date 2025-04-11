const TelegramBot = require('node-telegram-bot-api');
const logger = require('../utils/logger');
const config = require('../config/config');
const confluenceService = require('../services/confluenceService');
const registerCommands = require('./commands');
const registerCallbackHandlers = require('./callbackHandler');
const registerMessageHandler = require('./messageHandler');
const helpers = require('./helpers');

/**
 * Initialize and start the Telegram bot
 */
function startBot() {
  // Initialize Telegram Bot
  const bot = new TelegramBot(config.telegram.botToken, { polling: true });
  
  logger.info('Confluence detection bot started');
  
  // Register all handlers
  registerCommands(bot);
  registerCallbackHandlers(bot);
  registerMessageHandler(bot);
  
  // Handle polling errors
  bot.on('polling_error', (error) => {
    logger.error('Telegram polling error:', error);
  });
  
  // Setup cleaning interval for old transactions
  helpers.setupCleaningInterval(() => {
    confluenceService.cleanOldTransactions();
  });
  
  return bot;
}

module.exports = { startBot };