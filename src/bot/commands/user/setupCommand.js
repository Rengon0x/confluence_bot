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
    
    // Check if trackers already exist in this group
    const existingTrackers = await db.getGroupTrackers(chatId.toString());
    
    if (existingTrackers && existingTrackers.length > 0) {
      // Build a list of existing trackers
      let trackerList = existingTrackers.map(t => `• ${t.trackerName} (${t.type || 'cielo'})`).join('\n');
      
      bot.sendMessage(
        chatId,
        `ℹ️ This group already has ${existingTrackers.length} tracker(s) configured:\n\n` +
        `${trackerList}\n\n` +
        `To manage existing trackers:\n` +
        `• Use /trackers to view and manage all trackers\n` +
        `• Use /settings to change confluence detection settings\n\n` +
        `Do you want to add another tracker? Reply with the tracker username. ex: @defined_bot`
      );
    }
    
    // Store setup state in a Map (could be replaced with Redis in production)
    const setupStates = bot.setupStates || new Map();
    bot.setupStates = setupStates;
    
    // Mark this user as being in setup mode
    setupStates.set(`${chatId}_${userId}`, {
      state: 'awaiting_tracker_name',
      timestamp: Date.now()
    });
    
    // If no existing trackers, show the normal message
    if (!existingTrackers || existingTrackers.length === 0) {
      bot.sendMessage(
        chatId,
        "Please enter the username of the tracker bot you want to monitor.\n\n" +
        "Example: @defined_bot"
      );
    }
    
    // Set up message handler to catch the next message from this user
    const setupListener = async (replyMsg) => {
      // Only process if it's from the same user in the same chat
      if (replyMsg.chat.id === chatId && replyMsg.from.id === userId) {
        const setupState = setupStates.get(`${chatId}_${userId}`);
        
        // Check if user is in setup mode and awaiting tracker name
        if (setupState && setupState.state === 'awaiting_tracker_name') {
          const message = replyMsg.text.trim();
          
          // Check if message is a command (starts with /)
          if (message.startsWith('/')) {
            // It's a command, don't process it as a tracker name
            return;
          }
          
          // Check if message starts with @
          if (!message.startsWith('@')) {
            bot.sendMessage(chatId, "❌ Tracker username must start with @. Please try again (e.g., @defined_bot)");
            return;
          }
          
          // Check if message matches expected format (starts with @ or contains a username)
          const trackerMatch = message.match(/@([a-zA-Z0-9_]{5,32})/);
          
          if (!trackerMatch) {
            bot.sendMessage(chatId, "Please provide a valid username (e.g., @defined_bot)");
            return;
          }
          
          // Extract tracker name
          let trackerName = trackerMatch[1];
          
          logger.debug(`Extracted tracker name: ${trackerName}`);
          
          // Check if this tracker is already added to the group
          const existingTracker = existingTrackers.find(t => t.trackerName === trackerName);
          if (existingTracker) {
            bot.sendMessage(
              chatId,
              `❌ The tracker @${trackerName} is already configured in this group as a ${existingTracker.type} tracker.\n\n` +
              `Use /trackers to manage existing trackers.`
            );
            setupStates.delete(`${chatId}_${userId}`);
            bot.removeListener('message', setupListener);
            return;
          }
          
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
            // Try alternative methods to check forwarder presence
            let forwarder1IsAdmin = false;
            let forwarder2IsAdmin = false;
            
            try {
              // First check if they're admins (more reliable than checking members)
              const admins = await bot.getChatAdministrators(chatId);
              
              for (const admin of admins) {
                if (admin.user.username === config.telegram.forwarders[0].forwarderUsername) {
                  forwarder1IsAdmin = true;
                }
                if (admin.user.username === config.telegram.forwarders[1].forwarderUsername) {
                  forwarder2IsAdmin = true;
                }
              }
              
              logger.debug(`Admin check: Forwarder1=${forwarder1IsAdmin}, Forwarder2=${forwarder2IsAdmin}`);
            } catch (adminError) {
              logger.debug(`Could not check admins: ${adminError.message}`);
            }
            
            // If not found as admins, try direct approach
            let forwarder1Present = forwarder1IsAdmin;
            let forwarder2Present = forwarder2IsAdmin;
            
            // Only try getChatMember if they're not already found as admins
            if (!forwarder1Present) {
              try {
                const member1 = await bot.getChatMember(chatId, `@${config.telegram.forwarders[0].forwarderUsername}`);
                forwarder1Present = member1 && ['creator', 'administrator', 'member'].includes(member1.status);
              } catch (e) {
                // Silently fail - useraccounts might not be queryable
                logger.debug(`Could not check forwarder1 membership: ${e.message}`);
              }
            }
            
            if (!forwarder2Present) {
              try {
                const member2 = await bot.getChatMember(chatId, `@${config.telegram.forwarders[1].forwarderUsername}`);
                forwarder2Present = member2 && ['creator', 'administrator', 'member'].includes(member2.status);
              } catch (e) {
                // Silently fail - useraccounts might not be queryable
                logger.debug(`Could not check forwarder2 membership: ${e.message}`);
              }
            }
            
            // Only warn if BOTH forwarders are missing
            if (!forwarder1Present && !forwarder2Present) {
              bot.sendMessage(
                chatId,
                `⚠️ No forwarder accounts detected in this group.\n` +
                `Please add at least one of:\n` +
                `• @${config.telegram.forwarders[0].forwarderUsername} (Primary forwarder)\n` +
                `• @${config.telegram.forwarders[1].forwarderUsername} (Backup forwarder)\n\n` +
                `The bot needs at least one forwarder with admin privileges to function.`
              );
            } else if ((forwarder1Present && !forwarder1IsAdmin) || (forwarder2Present && !forwarder2IsAdmin)) {
              // At least one forwarder is present but not admin
              let needsAdminList = [];
              
              if (forwarder1Present && !forwarder1IsAdmin) needsAdminList.push(`@${config.telegram.forwarders[0].forwarderUsername}`);
              if (forwarder2Present && !forwarder2IsAdmin) needsAdminList.push(`@${config.telegram.forwarders[1].forwarderUsername}`);
              
              bot.sendMessage(
                chatId,
                `ℹ️ Forwarder(s) detected but need admin privileges:\n` +
                `${needsAdminList.join('\n')}`
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
                  { text: 'Cielo', callback_data: `set_tracker_type:${trackerName}:cielo` },
                  { text: 'Defined', callback_data: `set_tracker_type:${trackerName}:defined` },
                  { text: 'Ray', callback_data: `set_tracker_type:${trackerName}:ray` }
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
    // If getChatMember throws an error, it could mean:
    // 1. The user is not in the chat
    // 2. It's a userbot/useraccount that can't be queried
    // 3. The bot doesn't have permission to check
    logger.debug(`Could not check if ${username} is in chat: ${error.message}`);
    return false;
  }
}

async function registerTracking(trackerName, groupId, groupName, trackerType = 'cielo', userId = null, username = null) {
  try {
    // First check how many trackers are already configured for this group
    const existingTrackers = await getTrackersForGroup(groupId);
    
    // If already 5 trackers, deny adding a new one
    if (existingTrackers && existingTrackers.length >= 5) {
      logger.warn(`Group ${groupId} (${groupName}) attempting to add tracker but already has maximum of 5`);
      return { success: false, reason: 'MAX_TRACKERS_REACHED' };
    }
    
    // Existing code...
    const group = await groupService.findOrCreate(groupId, groupName);
    const tracker = await trackerService.findOrCreate(trackerName, groupId, trackerType);
    
    // If userId and username are provided, create an entry for this user
    if (userId && username) {
      // Create an initial entry for this user
      // This helps us track who set up each tracker
      await userWalletService.addOrUpdateWallet(
        userId,
        username,
        'SETUP_MARKER', // Special address to mark the setup action
        `Setup ${trackerName}`, // Label indicating this is a setup record
        trackerType,
        groupId
      );
    }
    
    logger.info(`Registered tracking for ${trackerName} (${trackerType}) in group ${groupName}`);
    return { success: true };
  } catch (error) {
    logger.error(`Error in setupService.registerTracking: ${error.message}`);
    return { success: false, reason: 'ERROR', message: error.message };
  }
}

async function isUserAdmin(bot, chatId, username) {
  try {
    // Get the list of chat administrators
    const admins = await bot.getChatAdministrators(chatId);
    
    // Check if any admin matches the username
    return admins.some(admin => admin.user.username === username);
  } catch (error) {
    logger.debug(`Could not check if ${username} is admin: ${error.message}`);
    return false;
  }
}

module.exports = setupCommand;