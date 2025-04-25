// src/bot/commands/user/addTrackerCommand.js
const addTrackerCommand = {
    name: 'addtracker',
    regex: /\/addtracker(?:@\w+)?(?:\s+(.+))?/,
    description: 'Add a tracker to monitor in this group',
    handler: async (bot, msg, match) => {
      // Only respond in groups
      if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') {
        bot.sendMessage(msg.chat.id, "This command can only be used in groups.");
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
          `/addtracker @CieloTrackerPrivate_bot`
        );
        return;
      }
      
      // Clean tracker name format
      trackerName = trackerName.replace(/^@/, '');
      
      try {
        // Register the tracker
        const success = await db.registerTracking(trackerName, chatId.toString(), chatName);
        
        if (success) {
          bot.sendMessage(
            chatId,
            `✅ Added *${trackerName}* to monitoring in this group.\n\n` +
            `Make sure the bot @${config.telegram.botUsername} and forwarders ` +
            `@${config.telegram.forwarders[0].forwarderUsername} and ` +
            `@${config.telegram.forwarders[1].forwarderUsername} are all admins in this group.`,
            { parse_mode: 'Markdown' }
          );
        } else {
          bot.sendMessage(
            chatId,
            `❌ Failed to add tracker. Please try again.`
          );
        }
      } catch (error) {
        logger.error(`Error adding tracker: ${error.message}`);
        bot.sendMessage(
          chatId,
          `❌ Error: ${error.message}`
        );
      }
    }
  };
  
  module.exports = addTrackerCommand;