// src/bot/commands/user/statusCommand.js
const db = require('../../../db');

/**
 * Commande /status - Affiche l'état actuel du monitoring
 */
const statusCommand = {
  name: 'status',
  regex: /\/status(?:@\w+)?/,
  description: 'Check the current monitoring status',
  handler: async (bot, msg) => {
    // Ne réagir que dans les groupes
    if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') return;
    
    const chatId = msg.chat.id;
    
    // Obtenir le statut du suivi pour ce groupe
    const trackers = await db.getGroupTrackers(chatId.toString());
    
    if (!trackers || trackers.length === 0) {
      bot.sendMessage(chatId, "No active monitoring found. Use /setup to get started.");
      return;
    }
    
    // Formater une liste de tous les trackers surveillés
    const trackerList = trackers.map(t => 
      `• *${t.trackerName}* (${t.trackerType || 'cielo'}): ${t.active ? '✅ Active' : '❌ Inactive'}`
    ).join('\n');
    
    bot.sendMessage(
      chatId,
      "📊 *Monitoring Status*\n\n" +
      `This group is monitoring the following trackers:\n${trackerList}\n\n` +
      `Use /settings to view or change settings.`,
      { parse_mode: 'Markdown' }
    );
  }
};

module.exports = statusCommand;