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
        const success = await db.registerTracking(trackerName, chatId.toString(), query.message.chat.title, trackerType);
        
        if (success) {
          bot.editMessageText(
            `✅ Setup complete! I'm now monitoring *${trackerName}* (${trackerType}) in this group.\n\n` +
            `I'll alert you when multiple wallets buy or sell the same coin.\n\n` +
            `Default settings:\n` +
            `• Minimum wallets for confluence: ${config.confluence.minWallets}\n` +
            `• Time window: ${config.confluence.windowMinutes} minutes\n\n` +
            `You can change these with /settings`,
            {
              chat_id: chatId,
              message_id: query.message.message_id,
              parse_mode: 'Markdown'
            }
          );
        } else {
          bot.editMessageText(
            `❌ Setup failed. Please try again or contact support.`,
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
            { text: '⚠️ Yes, remove and delete all data', callback_data: `confirm_remove_${trackerName}` },
            { text: '❌ Cancel', callback_data: 'cancel_remove' }
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
              message += `Use \`/remove @trackername\` or click the remove button to remove a specific tracker.`;
              
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
        message += `Use \`/remove @trackername\` or click the remove button to remove a specific tracker.`;
        
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