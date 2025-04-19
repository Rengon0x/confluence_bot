// src/bot/commands/user/recapCommand.js
const logger = require('../../../utils/logger');
const recapService = require('../../../services/recapService');

/**
 * Command /recap - Shows a summary of first confluences per token
 */
const recapCommand = {
  name: 'recap',
  regex: /\/recap(?:@\w+)?(?:\s+peak)?/,
  description: 'View a summary of confluences from the last 48 hours',
  handler: async (bot, msg) => {
    try {
      // Only respond in groups
      if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') {
        bot.sendMessage(msg.chat.id, "This command can only be used in groups.");
        return;
      }
      
      const chatId = msg.chat.id;
      
      // Check if peak data was requested
      const includePeakData = msg.text.toLowerCase().includes('peak');
      
      // Inform the user that we're processing their request
      let loadingMessage = "⏳ Analyzing transactions... This may take a moment.";
      if (includePeakData) {
        loadingMessage = "⏳ Analyzing transactions and fetching peak market cap data... This may take a minute or two.";
      }
      
      const loadingMsg = await bot.sendMessage(chatId, loadingMessage);
      
      // Get confluences for this group
      const confluences = await recapService.getFirstConfluencesPerToken(chatId.toString(), includePeakData);
      
      if (confluences.length === 0) {
        await bot.editMessageText(
          "No confluences detected in the last 48 hours.",
          {
            chat_id: chatId,
            message_id: loadingMsg.message_id
          }
        );
        return;
      }
      
      // Format the message with results
      const recapMessage = recapService.formatRecapMessage(confluences, includePeakData);
      
      // Send or edit the message
      await bot.editMessageText(
        recapMessage,
        {
          chat_id: chatId,
          message_id: loadingMsg.message_id,
          parse_mode: 'Markdown'
        }
      );
      
      logger.info(`Recap command executed for group ${chatId}, ${confluences.length} confluences displayed, peak data: ${includePeakData}`);
    } catch (error) {
      logger.error(`Error in recap command: ${error.message}`);
      bot.sendMessage(
        msg.chat.id,
        `❌ An error occurred while analyzing confluences: ${error.message}`
      );
    }
  }
};

module.exports = recapCommand;