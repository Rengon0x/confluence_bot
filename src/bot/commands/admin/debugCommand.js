// src/bot/commands/admin/debugCommand.js
const logger = require('../../../utils/logger');
const confluenceService = require('../../../services/confluenceService');
const confluenceDbService = require('../../../db/services/confluenceDbService');

/**
 * Command /debug - Show debug information for a token
 */
const debugCommand = {
  name: 'debug',
  regex: /\/debug\s+(.+)/,
  description: 'Show debug information for a token',
  handler: async (bot, msg, match) => {
    const chatId = msg.chat.id;
    const token = match[1].trim();
    
    if (!token) {
      bot.sendMessage(chatId, "Please specify a token symbol or address to debug");
      return;
    }
    
    // Display a loading message
    const loadingMsg = await bot.sendMessage(chatId, `Gathering debug information for token: ${token}...`);
    
    try {
      logger.info(`Debug request for token: ${token} by user ${msg.from.id}`);
      
      // Find transactions for the token
      await confluenceService.findTransactionsForToken(token);
      
      // Check if this token has an active confluence in the database
      const hasActiveDbConfluence = await confluenceDbService.hasActiveConfluence(
        chatId.toString(), 
        token.length >= 30 ? token : null, // Only use as address if it looks like one
        token.length < 30 ? token : null   // Only use as symbol if it's short
      );
      
      // Get in-memory and database confluences concurrently
      let inMemoryConfluence = null;
      try {
        const confluenceKey = token.length >= 30 ? 
          `${chatId}_addr_${token}` : 
          `${chatId}_name_${token}`;
        inMemoryConfluence = await confluenceService.detectedConfluences.get(confluenceKey);
      } catch (err) {
        logger.error(`Error checking in-memory confluence: ${err.message}`);
      }
      
      let dbConfluence = null;
      try {
        dbConfluence = await confluenceDbService.findConfluence(
          chatId.toString(),
          token.length >= 30 ? token : null,
          token.length < 30 ? token : null
        );
      } catch (err) {
        logger.error(`Error checking DB confluence: ${err.message}`);
      }
      
      // Build message based on what we found
      let message = `📊 *Debug Information for ${token}*\n\n`;
      
      if (inMemoryConfluence) {
        message += `*In-Memory Cache Confluence Found*\n`;
        message += `- Wallets: ${inMemoryConfluence.wallets?.length || 0}\n`;
        message += `- Type: ${inMemoryConfluence.type || 'unknown'}\n`;
        message += `- Token: ${inMemoryConfluence.coin} (${inMemoryConfluence.coinAddress || 'no address'})\n`;
        message += `- Detection time: ${new Date(inMemoryConfluence.timestamp).toISOString()}\n\n`;
      } else {
        message += `*No in-memory confluence found*\n\n`;
      }
      
      if (dbConfluence) {
        message += `*Database Confluence Found*\n`;
        message += `- Wallets: ${dbConfluence.wallets?.length || 0}\n`;
        message += `- Type: ${dbConfluence.type || 'unknown'}\n`;
        message += `- Token: ${dbConfluence.tokenSymbol} (${dbConfluence.tokenAddress || 'no address'})\n`;
        message += `- Creation time: ${new Date(dbConfluence.timestamp).toISOString()}\n`;
        message += `- Last updated: ${new Date(dbConfluence.lastUpdated).toISOString()}\n`;
        message += `- Status: ${dbConfluence.isActive ? 'Active' : 'Inactive'}\n\n`;
      } else if (hasActiveDbConfluence) {
        message += `*Database Confluence Found (limited info)*\n`;
        message += `- Status: Active\n\n`;
      } else {
        message += `*No database confluence found*\n\n`;
      }
      
      message += `_Full debug information written to server logs._\n`;
      message += `_Use /cache command to view system-wide statistics._`;
      
      // Update the loading message
      await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: loadingMsg.message_id,
        parse_mode: 'Markdown'
      });
      
    } catch (error) {
      logger.error(`Error in debug command for token ${token}: ${error.message}`);
      await bot.editMessageText(
        `Error gathering debug information: ${error.message}. Check server logs for details.`,
        {
          chat_id: chatId,
          message_id: loadingMsg.message_id
        }
      );
    }
  }
};

module.exports = debugCommand;