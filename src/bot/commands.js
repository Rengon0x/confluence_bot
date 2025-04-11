const logger = require('../utils/logger');
const config = require('../config/config');
const db = require('../db');

/**
 * Register all command handlers for the bot
 * @param {TelegramBot} bot - The Telegram bot instance
 */
function registerCommands(bot) {
  /**
   * Handle /start command (private chat)
   */
  bot.onText(/\/start/, async (msg) => {
    // Only respond in private chats
    if (msg.chat.type !== 'private') return;
    
    const chatId = msg.chat.id;
    const firstName = msg.from.first_name;
    
    // List of supported trackers
    const supportedTrackers = [
      'CieloTrackerPrivate',
      'WalletTrackerBot',
      'WhaleWatcherBot',
      // Add more supported trackers here
    ];
    
    // Create inline keyboard with tracker options
    const keyboard = {
      inline_keyboard: [
        ...supportedTrackers.map(tracker => ([{
          text: tracker,
          callback_data: `tracker_${tracker}`
        }])),
        [{
          text: 'Custom Tracker',
          callback_data: 'tracker_custom'
        }]
      ]
    };
    
    // Send welcome message with tracker selection
    bot.sendMessage(
      chatId,
      `👋 Hi ${firstName}! I can detect when multiple wallets buy or sell the same coin.\n\n` +
      `Which wallet tracker would you like to monitor?`,
      { reply_markup: keyboard }
    );
  });
  
  /**
   * Handle /setup command (in groups)
   */
  bot.onText(/\/setup(?:@\w+)?(?:\s+(.+))?/, async (msg, match) => {
    // Only respond in groups
    if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') {
      bot.sendMessage(msg.chat.id, "This command can only be used in groups. Please add me to a group first.");
      return;
    }
    
    const chatId = msg.chat.id;
    const chatName = msg.chat.title;
    
    // Check if tracker was specified in command
    let trackerName = match && match[1] ? match[1].trim() : null;
    
    if (!trackerName) {
      // If no tracker specified, prompt them to specify one
      bot.sendMessage(
        chatId,
        "Please specify which tracker bot to monitor. For example:\n" +
        `/setup CieloTrackerPrivate`
      );
      return;
    }
    
    // Clean up tracker name format
    trackerName = trackerName.replace(/^@/, '');
    
    // Register this group for tracking the specified tracker
    try {
      // Register the tracking setup in the database
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
  });
  
  /**
   * Handle /stop command (in groups)
   */
  bot.onText(/\/stop/, async (msg) => {
    // Only respond in groups
    if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') return;
    
    const chatId = msg.chat.id;
    const chatName = msg.chat.title;
    
    // Get all trackers for this group
    const trackers = await db.getGroupTrackers(chatId.toString());
    
    if (!trackers || trackers.length === 0) {
      bot.sendMessage(
        chatId,
        "No active monitoring found in this group. Use /setup to start monitoring."
      );
      return;
    }
    
    // Remove all trackers
    let allRemoved = true;
    for (const tracker of trackers) {
      const success = await db.removeTracking(tracker.trackerName, chatId.toString());
      if (!success) allRemoved = false;
    }
    
    if (allRemoved) {
      bot.sendMessage(
        chatId,
        "🛑 All monitoring has been deactivated in this group.\n" +
        "To reactivate, use the /setup command with a tracker name."
      );
      logger.info(`Monitoring deactivated in group: ${chatName} (${chatId})`);
    } else {
      bot.sendMessage(
        chatId,
        "⚠️ Some trackers could not be removed. Please try again or use /remove for specific trackers."
      );
    }
  });
  
  /**
   * Handle /settings command (in groups)
   */
  bot.onText(/\/settings(?:@\w+)?/, async (msg) => {
    // Only respond in groups
    if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') return;
    
    const chatId = msg.chat.id;
    
    // Get current settings for this group
    const settings = await db.getGroupSettings(chatId.toString());
    
    if (!settings) {
      bot.sendMessage(chatId, "No active monitoring found. Use /setup first.");
      return;
    }
    
    // Create settings keyboard
    const keyboard = {
      inline_keyboard: [
        [{
          text: `Min Wallets: ${settings.minWallets}`,
          callback_data: `set_min_wallets`
        }],
        [{
          text: `Time Window: ${settings.windowMinutes} mins`,
          callback_data: `set_time_window`
        }]
      ]
    };
    
    bot.sendMessage(
      chatId,
      "📊 *Confluence Detection Settings*\n\n" +
      `Current configuration:\n` +
      `• Minimum wallets for confluence: ${settings.minWallets}\n` +
      `• Time window: ${settings.windowMinutes} minutes\n\n` +
      `Select a setting to change:`,
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      }
    );
  });
  
  /**
   * Handle /status command (in groups)
   */
  bot.onText(/\/status(?:@\w+)?/, async (msg) => {
    // Only respond in groups
    if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') return;
    
    const chatId = msg.chat.id;
    
    // Get tracking status for this group
    const trackers = await db.getGroupTrackers(chatId.toString());
    
    if (!trackers || trackers.length === 0) {
      bot.sendMessage(chatId, "No active monitoring found. Use /setup to get started.");
      return;
    }
    
    // Format a list of all trackers being monitored
    const trackerList = trackers.map(t => 
      `• *${t.trackerName}*: ${t.active ? '✅ Active' : '❌ Inactive'}`
    ).join('\n');
    
    bot.sendMessage(
      chatId,
      "📊 *Monitoring Status*\n\n" +
      `This group is monitoring the following trackers:\n${trackerList}\n\n` +
      `Use /settings to view or change settings.`,
      { parse_mode: 'Markdown' }
    );
  });
  
  /**
   * Handle /remove command (in groups)
   */
  bot.onText(/\/remove(?:@\w+)?\s+(.+)/, async (msg, match) => {
    // Only respond in groups
    if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') return;
    
    const chatId = msg.chat.id;
    const trackerName = match[1].trim().replace(/^@/, '');
    
    // Remove the tracker from monitoring
    const success = await db.removeTracking(trackerName, chatId.toString());
    
    if (success) {
      bot.sendMessage(
        chatId,
        `✅ Stopped monitoring *${trackerName}* in this group.`,
        { parse_mode: 'Markdown' }
      );
    } else {
      bot.sendMessage(
        chatId,
        `❌ Error: *${trackerName}* is not being monitored in this group.`,
        { parse_mode: 'Markdown' }
      );
    }
  });
}

module.exports = registerCommands;