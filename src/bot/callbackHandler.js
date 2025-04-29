// src/bot/callbackHandler.js
const logger = require('../utils/logger');
const config = require('../config/config');
const helpers = require('./helpers');
const db = require('../db');

/**
 * Register callback handlers for inline buttons
 * @param {TelegramBot} bot - The Telegram bot instance
 */
function registerCallbackHandlers(bot) {
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const data = query.data;
    
    // Acknowledge the callback query
    bot.answerCallbackQuery(query.id);
    
    // Handle forwarder explanation
    if (data === 'explain_forwarders') {
      const forwarder1Username = config.telegram.forwarders?.[0]?.forwarderUsername || 'YourForwarderUsername';
      const forwarder2Username = config.telegram.forwarders?.[1]?.forwarderUsername || 'YourBackupForwarderUsername';
      
      // Create back button
      const backButton = {
        inline_keyboard: [[{
          text: "🔙 Back to main help",
          callback_data: "back_to_help"
        }]]
      };
      
      try {
        await bot.editMessageText(
          `*Why Forwarder Accounts Are Needed*\n\n` +
          `Due to Telegram API limitations, regular bots cannot read messages from other bots or users. To overcome this:\n\n` +
          
          `1️⃣ The forwarder accounts (@${forwarder1Username} and @${forwarder2Username}) are user accounts managed by code.\n\n` +
          
          `2️⃣ These forwarder accounts can see all messages in your group, including those from wallet trackers.\n\n` +
          
          `3️⃣ When they detect wallet transactions, they forward this data to our system for confluence analysis.\n\n` +
          
          `4️⃣ This setup is necessary because Telegram doesn't allow bots to directly read messages from other bots.\n\n` +
          
          `*Security Notes:*\n` +
          `• The forwarders only process wallet tracker messages for confluence detection\n` +
          `• They ignore all other conversations in your group\n` +
          `• Your privacy is important - no message content is stored except transaction data\n` +
          `• We recommend using them in a dedicated tracking group\n\n` +
          
          `*Why Two Forwarders?*\n` +
          `@${forwarder2Username} serves as a backup if the primary forwarder experiences connection issues.`,
          {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown',
            reply_markup: backButton
          }
        );
      } catch (error) {
        logger.error(`Error displaying forwarder explanation: ${error.message}`);
      }
      
      return;
    }
    
    // Handle "back to help" button
    if (data === 'back_to_help') {
      const forwarder1Username = config.telegram.forwarders?.[0]?.forwarderUsername || 'YourForwarderUsername';
      const forwarder2Username = config.telegram.forwarders?.[1]?.forwarderUsername || 'YourBackupForwarderUsername';
      
      // Create explanation button again
      const explainButton = {
        inline_keyboard: [[{
          text: "❓ Why do I need to add NoesisWatcher accounts?",
          callback_data: "explain_forwarders"
        }]]
      };
      
      // Check if we're in a help or start message
      const messageText = query.message.text;
      
      if (messageText.includes('CONFLUENCE DETECTION BOT - HELP GUIDE') || messageText.includes('CONFLUENCE DETECTION BOT - COMMANDS')) {
        // It's a help message
        const helpText = 
          `🤖 *Confluence Detection Bot - Commands*\n\n` +
          
          `*Available Commands:*\n` +
          `/setup - Start monitoring a new tracker\n` +
          `/trackers - View and manage active trackers\n` +
          `/stop - Stop all monitoring in this group\n` +
          `/status - Check active monitoring status\n` +
          `/settings - Configure detection settings\n` +
          `/recap - View performance of recent confluences\n` +
          `/quickrecap - View quick ATH summary\n` +
          `/help - Show this help message\n\n` +
          
          `*Supported Tracker Types:*\n` +
          `• Cielo • Defined • Ray\n\n` +
          
          `*Tips:*\n` +
          `• Monitor multiple trackers for better results\n` +
          `• Default: 2+ wallets buying same token in 60 minutes\n` +
          `• Bot requires @${forwarder1Username} and @${forwarder2Username} as admins\n\n` +
          
          `For support: @${config.supportContact}`;
        
        await bot.editMessageText(helpText, {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: 'Markdown',
          reply_markup: explainButton
        });
      } else {
        // Assume it's a start message - determine if group or private
        if (query.message.chat.type === 'group' || query.message.chat.type === 'supergroup') {
          // Group chat
          const firstName = query.message.chat.first_name || 'there';
          
          await bot.editMessageText(
            `👋 Hello ${firstName}!\n\n` +
            `*What this bot does:*\n` +
            `I detect when multiple wallets buy or sell the same cryptocurrency within a set time period (confluence), helping you spot trending tokens early.\n\n` +
            
            `*Quick setup:*\n` +
            `1️⃣ Make me an admin in this group\n` +
            `2️⃣ Add @${forwarder1Username} and make it admin\n` +
            `3️⃣ Type /setup and follow the prompts\n\n` +
            
            `*Recommended:* Also add @${forwarder2Username} as admin (backup system).\n\n` +
            
            `Type /help for all available commands.`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              reply_markup: explainButton
            }
          );
        } else {
          // Private chat
          const firstName = query.from.first_name || 'there';
          
          await bot.editMessageText(
            `👋 Hello ${firstName}!\n\n` +
            `*What this bot does:*\n` +
            `I monitor wallet trackers and alert you when multiple wallets buy or sell the same cryptocurrency within a specific time period (confluence), helping you spot trending tokens early.\n\n` +
            
            `*Setup in 3 steps:*\n` +
            `1️⃣ Add me to your Telegram group\n` +
            `2️⃣ Add @${forwarder1Username} to the group and make both of us admins\n` +
            `3️⃣ Type /setup in the group\n\n` +
            
            `*Recommended:* Also add @${forwarder2Username} as admin (backup system).\n\n` +
            
            `*Tip:* You can monitor multiple trackers in the same group for more data!\n\n` +
            
            `Type /help for all available commands.`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown',
              reply_markup: explainButton
            }
          );
        }
      }
      
      return;
    }
    
    // Handle tracker type selection
    if (data.startsWith('set_tracker_type:')) {
      const parts = data.split(':');
      const trackerName = parts[1];
      const trackerType = parts[2];
      
      // Clean up setup state
      const setupStates = bot.setupStates || new Map();
      setupStates.delete(`${chatId}_${userId}`);
      
      try {
        // Register tracking setup in the database with tracker type
        const result = await db.registerTracking(
          trackerName, 
          chatId.toString(), 
          query.message.chat.title, 
          trackerType,
          userId.toString(),
          query.from.username
        );
        
        if (result.success) {
          const groupSettings = await db.getGroupSettings(chatId.toString());
          bot.editMessageText(
            `✅ Setup complete! I'm now monitoring *${trackerName}* (${trackerType}) in this group.\n\n` +
            `I'll alert you when multiple wallets buy or sell the same coin.\n\n` +
            `Current settings:\n` +
            `• Minimum wallets for confluence: ${groupSettings.minWallets}\n` +
            `• Time window: ${groupSettings.windowMinutes} minutes\n\n` +
            `You can change these with /settings`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown'
            }
          );
        } else if (result.reason === 'MAX_TRACKERS_REACHED') {
          bot.editMessageText(
            `⚠️ Maximum trackers reached!\n\n` +
            `This group already has 5 trackers configured, which is the maximum allowed.\n\n` +
            `Please remove an existing tracker with /trackers before adding a new one.`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown'
            }
          );
        } else {
          bot.editMessageText(
            `❌ Setup failed. ${result.message || 'Please try again or contact support.'}`,
            {
              chat_id: chatId,
              message_id: query.message.message_id
            }
          );
        }
      } catch (error) {
        logger.error(`Error setting up tracker: ${error.message}`);
        bot.editMessageText(
          `❌ Error: ${error.message}`,
          {
            chat_id: chatId,
            message_id: query.message.message_id
          }
        );
      }
      
      return;
    }
    
    // Handle tracker removal
    if (data.startsWith('remove_tracker_')) {
      const trackerName = data.replace('remove_tracker_', '');
      
      // Ask for confirmation
      const confirmKeyboard = {
        inline_keyboard: [
          [
            { text: "⚠️ Yes, remove and delete all data", callback_data: `confirm_remove_${trackerName}` },
            { text: "❌ Cancel", callback_data: 'cancel_remove' }
          ]
        ]
      };
      
      bot.editMessageText(
        `⚠️ *Are you sure you want to remove ${trackerName}?*\n\n` +
        `This action will:\n` +
        `• Stop monitoring this tracker\n` +
        `• Delete all confluences detected from this tracker\n` +
        `• Delete all transaction history related to this tracker\n` +
        `• Delete all cached data for this tracker\n\n` +
        `*This action cannot be undone!*`,
        {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: 'Markdown',
          reply_markup: confirmKeyboard
        }
      );
      
      return;
    }
    
    // Handle confirmed removal
    if (data.startsWith('confirm_remove_')) {
      const trackerName = data.replace('confirm_remove_', '');
      
      try {
        // Remove the tracker from the group
        const success = await db.removeTracking(trackerName, chatId.toString());
        
        if (success) {
          bot.editMessageText(
            `✅ Successfully removed *${trackerName}* from monitoring in this group.\n\n` +
            `All associated data has been deleted.`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown'
            }
          );
          
          // Send a new tracker list after a short delay
          setTimeout(async () => {
            const trackers = await db.getGroupTrackers(chatId.toString());
            
            if (trackers && trackers.length > 0) {
              let message = "📋 *Active Trackers in This Group*\n\n";
              const inline_keyboard = [];
              
              for (let i = 0; i < trackers.length; i++) {
                const tracker = trackers[i];
                const status = tracker.active ? '✅' : '❌';
                
                message += `${i + 1}. ${status} *${tracker.trackerName}*\n`;
                message += `   Added: ${new Date(tracker.createdAt).toLocaleDateString()}\n`;
                
                if (tracker.type) {
                  message += `   Type: ${tracker.type}\n`;
                }
                
                message += '\n';
                
                inline_keyboard.push([{
                  text: `🗑 Remove ${tracker.trackerName}`,
                  callback_data: `remove_tracker_${tracker.trackerName}`
                }]);
              }
              
              message += `Total trackers: ${trackers.length}\n\n`;
              message += `⚠️ *WARNING:* Removing a tracker will delete all associated data.\n\n`;
              message += `Click the remove button below to remove a specific tracker.`;
              
              bot.sendMessage(chatId, message, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard }
              });
            } else {
              bot.sendMessage(
                chatId,
                "📋 No trackers are currently being monitored in this group.\n\n" +
                "Use /setup to add a tracker."
              );
            }
          }, 2000);
        } else {
          bot.editMessageText(
            `❌ Error: Could not remove *${trackerName}*. Please try again.`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown'
            }
          );
        }
      } catch (error) {
        logger.error(`Error removing tracker: ${error.message}`);
        bot.editMessageText(
          `❌ Error: ${error.message}`,
          {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: 'Markdown'
          }
        );
      }
      
      return;
    }
    
    // Handle cancelled removal
    if (data === 'cancel_remove') {
      // Return to the tracker list
      const trackers = await db.getGroupTrackers(chatId.toString());
      
      if (trackers && trackers.length > 0) {
        let message = "📋 *Active Trackers in This Group*\n\n";
        const inline_keyboard = [];
        
        for (let i = 0; i < trackers.length; i++) {
          const tracker = trackers[i];
          const status = tracker.active ? '✅' : '❌';
          
          message += `${i + 1}. ${status} *${tracker.trackerName}*\n`;
          message += `   Added: ${new Date(tracker.createdAt).toLocaleDateString()}\n`;
          
          if (tracker.type) {
            message += `   Type: ${tracker.type}\n`;
          }
          
          message += '\n';
          
          inline_keyboard.push([{
            text: `🗑 Remove ${tracker.trackerName}`,
            callback_data: `remove_tracker_${tracker.trackerName}`
          }]);
        }
        
        message += `Total trackers: ${trackers.length}\n\n`;
        message += `⚠️ *WARNING:* Removing a tracker will delete all associated data.\n\n`;
        message += `Click the remove button below to remove a specific tracker.`;
        
        bot.editMessageText(message, {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard }
        });
      }
      
      return;
    }
    
    // Handle setting changes
    if (data === 'set_min_wallets') {
      // Store the state for this chat to expect a number input
      const settingStates = bot.settingStates || new Map();
      bot.settingStates = settingStates;
      
      settingStates.set(`${chatId}_${userId}`, {
        setting: 'minWallets',
        timestamp: Date.now()
      });
      
      bot.sendMessage(
        chatId,
        "Please send the minimum number of wallets required for confluence detection (2-10):"
      );
      
      // Set up a one-time listener for the next message from this user
      const settingListener = async (msg) => {
        if (msg.chat.id === chatId && msg.from.id === userId) {
          const settingState = settingStates.get(`${chatId}_${userId}`);
          
          if (settingState && settingState.setting === 'minWallets') {
            const value = parseInt(msg.text);
            
            if (isNaN(value) || value < 2 || value > 10) {
              bot.sendMessage(chatId, "❌ Invalid value. Please enter a number between 2 and 10.");
              return;
            }
            
            try {
              await db.updateGroupSettings(chatId.toString(), { minWallets: value });
              bot.sendMessage(chatId, `✅ Minimum wallets updated to ${value}`);
            } catch (error) {
              bot.sendMessage(chatId, `❌ Failed to update settings: ${error.message}`);
            }
            
            settingStates.delete(`${chatId}_${userId}`);
            bot.removeListener('message', settingListener);
          }
        }
      };
      
      bot.on('message', settingListener);
      
      // Clean up after 5 minutes
      setTimeout(() => {
        settingStates.delete(`${chatId}_${userId}`);
        bot.removeListener('message', settingListener);
      }, 300000);
    }
    
    if (data === 'set_time_window') {
      // Store the state for this chat to expect a number input
      const settingStates = bot.settingStates || new Map();
      bot.settingStates = settingStates;
      
      settingStates.set(`${chatId}_${userId}`, {
        setting: 'windowMinutes',
        timestamp: Date.now()
      });
      
      bot.sendMessage(
        chatId,
        "Please send the time window in minutes (60-2880, i.e. 1-48 hours):"
      );
      
      // Set up a one-time listener for the next message from this user
      const settingListener = async (msg) => {
        if (msg.chat.id === chatId && msg.from.id === userId) {
          const settingState = settingStates.get(`${chatId}_${userId}`);
          
          if (settingState && settingState.setting === 'windowMinutes') {
            const value = parseInt(msg.text);
            
            if (isNaN(value) || value < 60 || value > 2880) {
              bot.sendMessage(chatId, "❌ Invalid value. Please enter a number between 60 and 2880 minutes.");
              return;
            }
            
            try {
              await db.updateGroupSettings(chatId.toString(), { windowMinutes: value });
              bot.sendMessage(chatId, `✅ Time window updated to ${value} minutes`);
            } catch (error) {
              bot.sendMessage(chatId, `❌ Failed to update settings: ${error.message}`);
            }
            
            settingStates.delete(`${chatId}_${userId}`);
            bot.removeListener('message', settingListener);
          }
        }
      };
      
      bot.on('message', settingListener);
      
      // Clean up after 5 minutes
      setTimeout(() => {
        settingStates.delete(`${chatId}_${userId}`);
        bot.removeListener('message', settingListener);
      }, 300000);
    }
  });
}

module.exports = registerCallbackHandlers;