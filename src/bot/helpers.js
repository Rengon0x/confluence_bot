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
    
    // Get forwarder usernames from config
    const forwarder1Username = config.telegram.forwarders && config.telegram.forwarders[0] ? 
      config.telegram.forwarders[0].forwarderUsername : 'YourForwarderUsername';
    
    const forwarder2Username = config.telegram.forwarders && config.telegram.forwarders[1] ? 
      config.telegram.forwarders[1].forwarderUsername : 'YourBackupForwarderUsername';
    
    // Send message without any parse_mode to avoid formatting issues
    bot.sendMessage(
      chatId,
      `Great! You've selected ${tracker} to monitor.\n\n` +
      `Please follow these steps:\n\n` +
      `1️⃣ Add me (@${config.telegram.botUsername}) to your group\n` +
      `2️⃣ Add ${tracker} to the same group\n` +
      `3️⃣ Add our forwarder account (@${forwarder1Username}) to the group.\n` +
      `4️⃣ Make me and both forwarders admin in the group (we need to read messages)\n` +
      `5️⃣ Use /setup in the group, then enter ${trackerName} when prompted\n` +
      `6️⃣ Select the tracker type (Cielo, Defined, or Ray)\n\n` +
      `Once set up, I'll alert you when multiple wallets buy or sell the same coin!\n\n` +
      `Note: We recommend also adding our backup forwarder @${forwarder2Username} to your group. This serves as a fallback system if the main forwarder @${forwarder1Username} experiences connectivity issues or becomes temporarily unavailable.`,
      {
        // No parse_mode here
        reply_markup: addToGroupButton
      }
    ).catch(error => {
      logger.error(`Failed to send plain setup instructions: ${error.message}`);
      
      // Ultimate fallback with minimal formatting
      bot.sendMessage(
        chatId,
        `I'll monitor ${tracker} for you. Add me and both forwarders (@${forwarder1Username} and @${forwarder2Username}) to your group, then type /setup there.`,
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