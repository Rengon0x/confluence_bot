// src/bot/commands/user/helpCommand.js
const config = require('../../../config/config');
const logger = require('../../../utils/logger');

/**
 * Command /help - Displays comprehensive help information about the bot
 */
const helpCommand = {
  name: 'help',
  regex: /\/help(?:@\w+)?/,
  description: 'Shows help information about the bot',
  handler: async (bot, msg) => {
    const chatId = msg.chat.id;
    const forwarder1Username = config.telegram.forwarders && config.telegram.forwarders[0] ? 
      config.telegram.forwarders[0].forwarderUsername : 'YourForwarderUsername';
    
    const forwarder2Username = config.telegram.forwarders && config.telegram.forwarders[1] ? 
      config.telegram.forwarders[1].forwarderUsername : 'YourBackupForwarderUsername';
    
    // Create explanation button
    const explainButton = {
      inline_keyboard: [[{
        text: "❓ Why do I need to add forwarder accounts?",
        callback_data: "explain_forwarders"
      }]]
    };
    
    try {
      const helpText = 
        `🤖 *Confluence Detection Bot - Commands*\n\n` +
        
        `*Available Commands:*\n` +
        `/setup - Start monitoring a new tracker\n` +
        `/trackers - View and manage active trackers\n` +
        `/stop - Stop all monitoring in this group\n` +
        `/status - Check active monitoring status\n` +
        `/settings - Configure detection settings\n` +
        `/help - Show this help message\n\n` +
        
        `*Supported Tracker Types:*\n` +
        `• Cielo • Defined • Ray\n\n` +
        
        `*Tips:*\n` +
        `• Monitor multiple trackers for better results\n` +
        `• Default: 2+ wallets buying same token in 60 minutes\n` +
        `• Bot requires @${forwarder1Username} and @${forwarder2Username} as admins\n\n` +
        
        `For support: @${config.supportContact}`;
      
      // Send the help message
      await bot.sendMessage(
        chatId,
        helpText,
        { 
          parse_mode: 'Markdown',
          reply_markup: explainButton
        }
      );
      
      logger.info(`Help command executed by user ${msg.from.id} in chat ${chatId}`);
    } catch (error) {
      logger.error(`Error in help command: ${error.message}`);
      bot.sendMessage(
        chatId,
        "Sorry, there was an error displaying the help information. Please try again later."
      );
    }
  }
};

module.exports = helpCommand;