// src/bot/commands/admin/debugCommand.js
const logger = require('../../../utils/logger');
const confluenceService = require('../../../services/confluenceService');

/**
 * Commande /debug - Affiche des informations de débogage pour un token
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
    
    logger.info(`Debug request for token: ${token} by user ${msg.from.id}`);
    confluenceService.findTransactionsForToken(token);
    bot.sendMessage(chatId, "Debug info written to logs. Check your server console or log files.");
  }
};

module.exports = debugCommand;