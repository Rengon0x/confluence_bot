// src/bot/commands/user/setupCommand.js
const logger = require('../../../utils/logger');
const db = require('../../../db');
const config = require('../../../config/config');

/**
 * Commande /setup - Configure un tracker pour un groupe
 */
const setupCommand = {
  name: 'setup',
  regex: /\/setup(?:@\w+)?(?:\s+(.+))?/,
  description: 'Setup a tracker in a group',
  handler: async (bot, msg, match) => {
    // Only respond in groups
    if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') {
      bot.sendMessage(msg.chat.id, "This command can only be used in groups. Please add me to a group first.");
      return;
    }
    
    const chatId = msg.chat.id;
    const chatName = msg.chat.title;
    
    // Check if a tracker has been specified
    let trackerName = match && match[1] ? match[1].trim() : null;
    
    if (!trackerName) {
      // If no tracker is specified, ask for one
      bot.sendMessage(
        chatId,
        "Please specify which tracker bot to monitor. For example:\n" +
        `/setup @CieloTrackerPrivate_bot`
      );
      return;
    }
    
    // Clean tracker name format
    trackerName = trackerName.replace(/^@/, '');
    
    // Check if forwarders are members of this group
    try {
      const forwarder1Present = await isUserInChat(bot, chatId, config.telegram.forwarders[0].forwarderUsername);
      const forwarder2Present = await isUserInChat(bot, chatId, config.telegram.forwarders[1].forwarderUsername);
      
      // If forwarders are missing, warn the user
      if (!forwarder1Present || !forwarder2Present) {
        let missingForwarders = [];
        
        if (!forwarder1Present) missingForwarders.push(`@${config.telegram.forwarders[0].forwarderUsername}`);
        if (!forwarder2Present) missingForwarders.push(`@${config.telegram.forwarders[1].forwarderUsername}`);
        
        bot.sendMessage(
          chatId,
          `⚠️ Warning: The following forwarder accounts are not in this group yet:\n` +
          `${missingForwarders.join(', ')}\n\n` +
          `Please add them and make them admins for the bot to work properly.`
        );
      }
      
      // Continue with normal setup logic
      // Register tracking setup in the database
      const success = await db.registerTracking(trackerName, chatId.toString(), chatName);
      
      if (success) {
        bot.sendMessage(
          chatId,
          `✅ Setup complete! I'm now monitoring *${trackerName}* in this group.\n\n` +
          `I'll alert you when multiple wallets buy or sell the same coin.\n\n` +
          `Default settings:\n` +
          `• Minimum wallets for confluence: ${config.confluence.minWallets}\n` +
          `• Time window: ${config.confluence.windowMinutes} minutes\n\n` +
          `You can change these with /settings`,
          { parse_mode: 'Markdown' }
        );
      } else {
        bot.sendMessage(
          chatId,
          `❌ Setup failed. Please try again or contact support.`
        );
      }
    } catch (error) {
      logger.error('Error in setup command:', error);
      bot.sendMessage(
        chatId,
        `❌ Setup failed: ${error.message}\n\nPlease try again or contact support.`
      );
    }
  }
};

async function isUserInChat(bot, chatId, username) {
  try {
    // Get chat member info for the specified username
    const chatMember = await bot.getChatMember(chatId, `@${username}`);
    return chatMember && ['creator', 'administrator', 'member'].includes(chatMember.status);
  } catch (error) {
    // If getChatMember throws an error, the user is likely not in the chat
    return false;
  }
}

module.exports = setupCommand;