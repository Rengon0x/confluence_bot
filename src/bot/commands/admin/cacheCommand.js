// src/bot/commands/admin/cacheCommand.js
const confluenceService = require('../../../services/confluenceService');

/**
 * Commande /cache - Affiche des informations sur le cache
 */
const cacheCommand = {
  name: 'cache',
  regex: /\/cache/,
  description: 'View cache information',
  handler: async (bot, msg) => {
    const chatId = msg.chat.id;
    
    // Appeler la méthode de diagnostic
    confluenceService.dumpTransactionsCache();
    
    // Récupérer quelques statistiques de base pour l'utilisateur
    const keys = confluenceService.transactionsCache.keys();
    const totalTransactions = keys.reduce((sum, key) => {
      const transactions = confluenceService.transactionsCache.get(key) || [];
      return sum + transactions.length;
    }, 0);
    
    const cacheStats = confluenceService.estimateCacheSize(); // Méthode à implémenter
    
    bot.sendMessage(chatId, 
      `Cache diagnosis written to logs.\n` +
      `Total keys in cache: ${keys.length}\n` +
      `Total transactions: ${totalTransactions}\n` +
      `Estimated cache size: ${cacheStats.estimatedSizeMB.toFixed(2)}MB`
    );
  }
};

module.exports = cacheCommand;