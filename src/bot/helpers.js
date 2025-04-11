const config = require('../config/config');
const logger = require('../utils/logger')

/**
 * Helper functions for the bot
 */
const helpers = {
  /**
   * Send setup instructions for a tracker
   * @param {TelegramBot} bot - The Telegram bot instance
   * @param {number} chatId - Chat ID to send instructions to
   * @param {string} tracker - Tracker name
   */
  sendSetupInstructions(bot, chatId, tracker) {
    // Remove @ from tracker name if present for processing
    const trackerName = tracker.replace(/^@/, '');
    
    // Create "Add to Group" button
    const addToGroupButton = {
      inline_keyboard: [[{
        text: "Add me to a group",
        url: `https://t.me/${config.telegram.botUsername}?startgroup=true`
      }]]
    };
    
    // Send message without any parse_mode to avoid formatting issues
    bot.sendMessage(
      chatId,
      `Great! You've selected ${tracker} to monitor.\n\n` +
      `Please follow these steps:\n\n` +
      `1️⃣ Add me (@${config.telegram.botUsername}) to your group\n` +
      `2️⃣ Add ${tracker} to the same group\n` +
      `3️⃣ Add our forwarder account (@${config.telegram.forwarderUsername || 'YourForwarderUsername'}) to the group\n` +
      `4️⃣ Make both me and the forwarder admin in the group (we need to read messages)\n` +
      `5️⃣ Send /setup ${trackerName} in the group to activate monitoring\n\n` +
      `Once set up, I'll alert you when multiple wallets buy or sell the same coin!`,
      {
        // No parse_mode here
        reply_markup: addToGroupButton
      }
    ).catch(error => {
      logger.error(`Failed to send plain setup instructions: ${error.message}`);
      
      // Ultimate fallback with minimal formatting
      bot.sendMessage(
        chatId,
        `I'll monitor ${tracker} for you. Add me to your group, then type /setup ${trackerName} there.`,
        {
          reply_markup: addToGroupButton
        }
      );
    });
  },

  /**
   * Setup a cleaning interval for old transactions
   * @param {Function} cleanFunction - The cleaning function to call
   * @param {number} intervalMinutes - Interval in minutes
   */
  setupCleaningInterval(cleanFunction, intervalMinutes = 1) {
    return setInterval(cleanFunction, intervalMinutes * 60 * 1000);
  }
};

module.exports = helpers;