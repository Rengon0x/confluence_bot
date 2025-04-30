const TelegramBot = require('node-telegram-bot-api');
const logger = require('../utils/logger');
const config = require('../config/config');
const confluenceService = require('../services/confluenceService');
const registerCommands = require('./commands');
const registerCallbackHandlers = require('./callbackHandler');
const registerMessageHandler = require('./messageHandler');
const setupAccessControlMiddleware = require('../middlewares/accessControlMiddleware');
const db = require('../db'); // Use db to access betaUserService
const helpers = require('./helpers');

/**
 * Initialize and start the Telegram bot
 */
async function startBot() {
  try {
    // Initialize Telegram Bot with polling disabled until middleware is set up
    const bot = new TelegramBot(config.telegram.botToken, { polling: false });
    
    logger.info('Confluence detection bot created, initializing services...');
    
    // Initialize beta users service first - WAIT for it to complete
    await db.betaUserService.initialize();
    logger.info('Beta users service initialized');
    
    // Setup access control middleware if enabled BEFORE registering commands
    if (config.accessControl && config.accessControl.enabled) {
      setupAccessControlMiddleware(bot);
      logger.info('Access control middleware set up');
    }
    
    // AFTER middleware is set up, register all handlers
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
    
    // NOW start polling after everything is set up
    bot.startPolling();
    logger.info('Bot polling started successfully');
    
    return bot;
  } catch (error) {
    logger.error('Error starting bot:', error);
    throw error;
  }
}

module.exports = { startBot };