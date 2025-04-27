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
    
    try {
      const helpText = 
        `🤖 *Confluence Detection Bot - Help Guide*\n\n` +
        
        `*How This Bot Works:*\n` +
        `This bot monitors wallet tracker channels and detects when multiple wallets buy or sell the same cryptocurrency within a specific time period (confluence). ` +
        `When a confluence is detected, the bot will send an alert to your group.\n\n` +
        
        `*Setup Instructions:*\n` +
        `1️⃣ Add this bot to your group\n` +
        `2️⃣ Add our forwarder account @${forwarder1Username} to your group\n` +
        `3️⃣ Make both the bot and forwarder admin in the group\n` +
        `4️⃣ Use the \`/setup\` command\n` +
        `5️⃣ Enter your tracker's username when prompted\n` +
        `6️⃣ Select the tracker type (Cielo, Defined, or Ray)\n` +
        `7️⃣ Wait for confluence alerts to appear!\n\n` +
        
        `*Note:* We recommend also adding our backup forwarder @${forwarder2Username} to your group. ` +
        `This serves as a fallback system if the main forwarder @${forwarder1Username} experiences connectivity issues or becomes temporarily unavailable.\n\n` +
        
        `*Available Commands:*\n\n` +
        
        `*Group Commands:*\n` +
        `/setup - Start the setup process for a new tracker\n` +
        `/trackers - View all active trackers in this group\n` +
        `/remove @tracker - Stop monitoring a specific tracker\n` +
        `/stop - Stop all monitoring in this group\n` +
        `/status - Check which trackers are being monitored\n` +
        `/settings - Configure bot settings\n` +
        `/recap - View performance of recent confluences\n` +
        `/quickrecap - View quick ATH summary\n` +
        `/help - Show this help message\n\n` +
        
        `*Private Chat Commands:*\n` +
        `/start - Begin the setup process\n\n` +
        
        `*Supported Tracker Types:*\n` +
        `• Cielo - For Cielo tracker format\n` +
        `• Defined - For Defined bot format\n` +
        `• Ray - For Ray tracker format\n\n` +
        
        `*Settings:*\n` +
        `• Min Wallets: Minimum wallets required to detect a confluence (default: ${config.confluence.minWallets})\n` +
        `• Time Window: Maximum time between transactions to be considered in the same confluence (default: ${config.confluence.windowMinutes} minutes)\n\n` +

          
        `*Tips:*\n` +
        `• You can monitor multiple wallet trackers in the same group\n` +
        `• Each tracker can be a different type (Cielo, Defined, or Ray)\n` +
        `• Use \`/trackers\` to see all active trackers and their types\n\n` +
        
        `For support, contact: @${config.supportContact}`;
      
      // Send the help message
      await bot.sendMessage(
        chatId,
        helpText,
        { parse_mode: 'Markdown' }
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