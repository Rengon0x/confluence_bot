// src/bot/commands/user/setupCommand.js
const logger = require('../../../utils/logger');
const db = require('../../../db');
const config = require('../../../config/config');

/**
 * Commande /setup - Configure un tracker pour un groupe
 */
const setupCommand = {
  name: 'setup',
  regex: /\/setup(?:@\w+)?$/,  // Match /setup without parameters
  description: 'Setup a tracker in a group',
  handler: async (bot, msg) => {
    // Only respond in groups
    if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') {
      bot.sendMessage(msg.chat.id, "This command can only be used in groups. Please add me to a group first.");
      return;
    }
    
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    // Store setup state in a Map (could be replaced with Redis in production)
    const setupStates = bot.setupStates || new Map();
    bot.setupStates = setupStates;
    
    // Mark this user as being in setup mode
    setupStates.set(`${chatId}_${userId}`, {
      state: 'awaiting_tracker_name',
      timestamp: Date.now()
    });
    
    // Ask for tracker name
    bot.sendMessage(
      chatId,
      "Please enter the username of the tracker bot you want to monitor.\n\n" +
      "Example: @CieloTrackerPrivate_bot"
    );
    
    // Set up message handler to catch the next message from this user
    const setupListener = async (replyMsg) => {
      // Only process if it's from the same user in the same chat
      if (replyMsg.chat.id === chatId && replyMsg.from.id === userId) {
        const setupState = setupStates.get(`${chatId}_${userId}`);
        
        // Check if user is in setup mode and awaiting tracker name
        if (setupState && setupState.state === 'awaiting_tracker_name') {
          // Check if message matches expected format (starts with @ or contains a username)
          const trackerMatch = replyMsg.text.match(/@?([a-zA-Z0-9_]{5,32})/);
          
          if (!trackerMatch) {
            bot.sendMessage(chatId, "Please provide a valid username (e.g., @CieloTrackerPrivate_bot)");
            return;
          }
          
          // Extract tracker name
          let trackerName = trackerMatch[1];
          
          logger.debug(`Extracted tracker name: ${trackerName}`);
          
          // Check if tracker is in the group
          try {
            const trackerMember = await bot.getChatMember(chatId, `@${trackerName}`);
            
            if (!trackerMember || !['creator', 'administrator', 'member'].includes(trackerMember.status)) {
              bot.sendMessage(
                chatId,
                `❌ The tracker @${trackerName} is not in this group. Please add it first, then try again.`
              );
              setupStates.delete(`${chatId}_${userId}`);
              bot.removeListener('message', setupListener);
              return;
            }
          } catch (error) {
            logger.debug(`Tracker ${trackerName} not found in group or not accessible`);
            // Continue anyway - some trackers might not be accessible via getChatMember
          }
          
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
            
            // Update setup state
            setupStates.set(`${chatId}_${userId}`, {
              state: 'awaiting_tracker_type',
              trackerName: trackerName,
              timestamp: Date.now()
            });
            
            // Now ask for tracker type
            const trackerTypeKeyboard = {
              inline_keyboard: [
                [
                  { text: '🔷 Cielo', callback_data: `set_tracker_type:${trackerName}:cielo` },
                  { text: '📊 Defined', callback_data: `set_tracker_type:${trackerName}:defined` },
                  { text: '🌟 Ray', callback_data: `set_tracker_type:${trackerName}:ray` }
                ]
              ]
            };
            
            bot.sendMessage(
              chatId,
              `What type of tracker is *${trackerName}*?`,
              {
                parse_mode: 'Markdown',
                reply_markup: trackerTypeKeyboard
              }
            );
            
          } catch (error) {
            logger.error('Error in setup command:', error);
            bot.sendMessage(
              chatId,
              `❌ Setup failed: ${error.message}\n\nPlease try again or contact support.`
            );
            setupStates.delete(`${chatId}_${userId}`);
          }
          
          // Remove the listener once we've processed the tracker name
          bot.removeListener('message', setupListener);
        }
      }
    };
    
    // Add the listener to bot
    bot.on('message', setupListener);
    
    // Set a timeout to clean up setup state and remove listener after 5 minutes
    setTimeout(() => {
      setupStates.delete(`${chatId}_${userId}`);
      bot.removeListener('message', setupListener);
      logger.debug(`Timeout: Cleaned up setup state for user ${userId} in chat ${chatId}`);
    }, 300000);  // 5 minutes
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