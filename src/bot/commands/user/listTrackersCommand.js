// src/bot/commands/user/listTrackersCommand.js
const logger = require('../../../utils/logger');
const db = require('../../../db');

/**
 * Command /listtrackers - Shows all active trackers in the group
 */
const listTrackersCommand = {
  name: 'listtrackers',
  regex: /\/listtrackers(?:@\w+)?/,
  description: 'View all active trackers in this group',
  handler: async (bot, msg) => {
    try {
      // Only respond in groups
      if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') {
        bot.sendMessage(msg.chat.id, "This command can only be used in groups.");
        return;
      }
      
      const chatId = msg.chat.id;
      
      // Get all trackers for this group
      const trackers = await db.getGroupTrackers(chatId.toString());
      
      if (!trackers || trackers.length === 0) {
        bot.sendMessage(
          chatId,
          "📋 No trackers are currently being monitored in this group.\n\n" +
          "Use /setup to add a tracker."
        );
        return;
      }
      
      // Format the tracker list
      let message = "📋 *Active Trackers in This Group*\n\n";
      
      // Create inline keyboard with remove buttons
      const inline_keyboard = [];
      
      for (let i = 0; i < trackers.length; i++) {
        const tracker = trackers[i];
        const status = tracker.active ? '✅' : '❌';
        
        message += `${i + 1}. ${status} *${tracker.trackerName}*\n`;
        message += `   Added: ${new Date(tracker.createdAt).toLocaleDateString()}\n`;
        
        // Add a remove button for each tracker
        inline_keyboard.push([{
          text: `🗑 Remove ${tracker.trackerName}`,
          callback_data: `remove_tracker_${tracker.trackerName}`
        }]);
        
        message += '\n';
      }
      
      message += `Total trackers: ${trackers.length}\n\n`;
      
      // Add warning about data deletion
      message += `⚠️ *WARNING:* Removing a tracker will also delete:\n`;
      message += `• All confluences detected from this tracker\n`;
      message += `• All transaction history related to this tracker\n`;
      message += `• All cached data for this tracker\n\n`;
      
      message += `Use \`/remove @trackername\` or click the remove button to remove a specific tracker.`;
      
      bot.sendMessage(
        chatId,
        message,
        { 
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard }
        }
      );
      
      logger.info(`ListTrackers command executed for group ${chatId}, ${trackers.length} trackers found`);
    } catch (error) {
      logger.error(`Error in listtrackers command: ${error.message}`);
      bot.sendMessage(
        msg.chat.id,
        "❌ An error occurred while retrieving the tracker list. Please try again later."
      );
    }
  }
};

module.exports = listTrackersCommand;