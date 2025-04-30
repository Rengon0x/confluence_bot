// src/bot/commands/user/recapCommand.js
const logger = require('../../../utils/logger');
const recapService = require('../../../services/recapService');
const { formatTimeframe, sendRecapMessage } = require('../../../utils/recapFormatter');

/**
 * Command /recap - Shows performance summary of confluences with optional timeframe
 * Examples: 
 * - /recap     (default 24h timeframe)
 * - /recap 6h  (6 hour timeframe)
 * - /recap 3d  (3 day timeframe)
 * - /recap 30m (30 minute timeframe)
 */
const recapCommand = {
  name: 'recap',
  regex: /\/recap(?:@\w+)?(?:\s+(\d+)([hmd]))?/,
  description: 'View performance summary of recent confluences with optional timeframe',
  handler: async (bot, msg, match) => {
    try {
      // Only respond in groups
      if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') {
        bot.sendMessage(msg.chat.id, "This command can only be used in groups.");
        return;
      }
      
      const chatId = msg.chat.id;
      
      // Parse timeframe parameter if provided (default to 24h)
      let timeframeHours = 24;
      
      if (match && match[1] && match[2]) {
        const value = parseInt(match[1]);
        const unit = match[2];
        
        if (unit === 'h') timeframeHours = value;
        else if (unit === 'd') timeframeHours = value * 24;
        else if (unit === 'm') timeframeHours = value / 60;
      }
      
      // Limit timeframe to reasonable values (min 1h, max 7d)
      timeframeHours = Math.max(1, Math.min(timeframeHours, 168));
      
      logger.info(`Executing recap command for group ${chatId} with timeframe ${timeframeHours}h`);
      
      // Inform the user that we're analyzing data
      const loadingMsg = await bot.sendMessage(
        chatId, 
        `⏳ Analyzing performance for the last ${formatTimeframe(timeframeHours)}... This may take a moment.`
      );
      
      // Get performance data for this timeframe
      const performanceData = await recapService.getPerformanceData(
        chatId.toString(), 
        timeframeHours
      );
      
      logger.info(`Recap analysis complete for group ${chatId}: found ${performanceData.confluences?.length || 0} confluences`);
      
      if (!performanceData || !performanceData.confluences || performanceData.confluences.length === 0) {
        await bot.editMessageText(
          `No confluences detected in the last ${formatTimeframe(timeframeHours)}. Perhaps try a longer timeframe like /recap 24h or /recap 3d.`,
          {
            chat_id: chatId,
            message_id: loadingMsg.message_id
          }
        );
        return;
      }
      
      // Send the recap message
      await sendRecapMessage(
        bot, 
        chatId, 
        loadingMsg.message_id, 
        performanceData, 
        timeframeHours
      );
      
      logger.info(`Recap successfully delivered for group ${chatId}, timeframe: ${timeframeHours}h, ${performanceData.confluences.length} confluences analyzed`);
    } catch (error) {
      logger.error(`Error in recap command: ${error.message}`, error);
      bot.sendMessage(
        msg.chat.id,
        `❌ An error occurred while analyzing performance: ${error.message}. Please try again later or contact support.`
      );
    }
  }
};

module.exports = recapCommand;