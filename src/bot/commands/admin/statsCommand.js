// src/bot/commands/admin/statsCommand.js
const performanceMonitor = require('../../../utils/performanceMonitor');
const confluenceService = require('../../../services/confluenceService');

/**
 * Command /stats - Show performance statistics and database information
 */
const statsCommand = {
  name: 'stats',
  regex: /\/stats(?:@\w+)?/,
  description: 'Get system performance and database statistics',
  handler: async (bot, msg) => {
    const chatId = msg.chat.id;
    
    // Display a loading message
    const loadingMsg = await bot.sendMessage(chatId, "Gathering system performance data...");
    
    try {
      // Generate fresh performance data if requested via flag
      if (msg.text.includes('refresh')) {
        performanceMonitor.generatePerformanceReport();
      }
      
      // Get performance report
      const performanceReport = performanceMonitor.getFormattedReport();
      
      // Get confluence storage stats
      const confluenceStats = await confluenceService.getConfluenceStats();
      
      // Format confluence stats
      let confluenceSection = '*Confluence Storage Stats*\n';
      confluenceSection += `- Total confluences: ${confluenceStats.totalCount}\n`;
      confluenceSection += `- Active confluences: ${confluenceStats.activeCount}\n`;
      confluenceSection += `- Avg wallets per confluence: ${confluenceStats.avgWallets.toFixed(2)}\n`;
      
      // Add top groups
      if (confluenceStats.groupStats && confluenceStats.groupStats.length > 0) {
        confluenceSection += '\n*Top 3 Groups by Confluence Count*\n';
        
        confluenceStats.groupStats.slice(0, 3).forEach((g, i) => {
          confluenceSection += `${i+1}. Group ${g._id}: ${g.activeCount} active / ${g.count} total\n`;
        });
      }
      
      // Get cache stats
      const cacheStats = await confluenceService.estimateCacheSize();
      let cacheSection = '\n*Cache Stats*\n';
      cacheSection += `- Estimated cache size: ${cacheStats.estimatedSizeMB.toFixed(2)}MB\n`;
      cacheSection += `- Total keys: ${cacheStats.totalKeys}\n`;
      
      // Combine all sections
      const fullMessage = `${performanceReport}\n\n${confluenceSection}\n${cacheSection}`;
      
      // Update the loading message
      await bot.editMessageText(fullMessage, {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
        parse_mode: 'Markdown'
      });
      
    } catch (error) {
      // Handle any errors that might occur
      await bot.editMessageText(
        `Error gathering performance statistics: ${error.message}`,
        {
          chat_id: chatId,
          message_id: loadingMsg.message_id
        }
      );
    }
  }
};

module.exports = statsCommand;