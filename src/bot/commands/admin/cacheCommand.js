// src/bot/commands/admin/cacheCommand.js
const confluenceService = require('../../../services/confluenceService');

/**
 * Command /cache - Show cache and confluence storage information
 */
const cacheCommand = {
  name: 'cache',
  regex: /\/cache/,
  description: 'View cache information and confluence storage status',
  handler: async (bot, msg) => {
    const chatId = msg.chat.id;
    
    // Display a loading message
    const loadingMsg = await bot.sendMessage(chatId, "Gathering cache and database information...");
    
    try {
      // Call the diagnostic methods
      confluenceService.dumpTransactionsCache();
      
      // Get transaction cache stats
      const keys = await confluenceService.transactionsCache.keys();
      const totalTransactions = await keys.reduce(async (promisedSum, key) => {
        const sum = await promisedSum;
        const transactions = await confluenceService.transactionsCache.get(key) || [];
        return sum + transactions.length;
      }, Promise.resolve(0));
      
      const cacheStats = await confluenceService.estimateCacheSize();
      
      // Get confluence storage stats
      const confluenceStats = await confluenceService.getConfluenceStats();
      
      // Force a cache-DB synchronization
      await confluenceService.forceSyncWithDatabase();
      
      // Create a detailed message
      const message = `
📊 *Cache and Storage Information*

*Transaction Cache:*
- Total keys: ${keys.length}
- Total transactions: ${totalTransactions}
- Estimated cache size: ${cacheStats.estimatedSizeMB.toFixed(2)}MB

*Confluence Storage:*
- Total confluences: ${confluenceStats.totalCount}
- Active confluences: ${confluenceStats.activeCount}
- Average wallets per confluence: ${confluenceStats.avgWallets.toFixed(2)}

*Group Statistics:*
${confluenceStats.groupStats.slice(0, 5).map(g => 
  `- Group ${g._id}: ${g.activeCount}/${g.count} active/total`
).join('\n')}
${confluenceStats.groupStats.length > 5 ? `...and ${confluenceStats.groupStats.length - 5} more groups` : ''}

_Cache diagnosis details written to server logs._
_Database-cache synchronization completed._
      `;
      
      // Update the loading message
      await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
        parse_mode: 'Markdown'
      });
    } catch (error) {
      bot.editMessageText(
        `Error gathering cache information: ${error.message}`,
        {
          chat_id: chatId,
          message_id: loadingMsg.message_id
        }
      );
    }
  }
};

module.exports = cacheCommand;