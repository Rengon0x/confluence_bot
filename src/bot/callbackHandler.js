const logger = require('../utils/logger');
const config = require('../config/config');
const helpers = require('./helpers');

/**
 * Register callback handlers for inline buttons
 * @param {TelegramBot} bot - The Telegram bot instance
 */
function registerCallbackHandlers(bot) {
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;
    
    // Acknowledge the callback query
    bot.answerCallbackQuery(query.id);
    
    // Handle tracker selection
    if (data.startsWith('tracker_')) {
      const tracker = data.replace('tracker_', '');
      
      if (tracker === 'custom') {
        // Ask user to enter custom tracker name
        bot.sendMessage(
          chatId,
          "Please enter the username of the tracker bot or channel you want to monitor (e.g., @YourTrackerBot):"
        );
        // Here you would need to implement state management to handle their response
        // For simplicity we're not implementing the full state management system
      } else {
        // Send setup instructions for selected tracker
        helpers.sendSetupInstructions(bot, chatId, tracker);
      }
    }
    
    // Handle setting changes
    if (data === 'set_min_wallets') {
      bot.sendMessage(
        chatId,
        "Please send the minimum number of wallets required for confluence detection (2-10):"
      );
      // Would need state management here
    }
    
    if (data === 'set_time_window') {
      bot.sendMessage(
        chatId,
        "Please send the time window in minutes (5-1440):"
      );
      // Would need state management here
    }
  });
}

module.exports = registerCallbackHandlers;