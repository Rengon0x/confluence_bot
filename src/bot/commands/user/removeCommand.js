// src/bot/commands/user/removeCommand.js
const db = require('../../../db');

/**
 * Commande /remove - Supprime un tracker spécifique
 */
const removeCommand = {
  name: 'remove',
  regex: /\/remove(?:@\w+)?\s+(.+)/,
  description: 'Remove a specific tracker from monitoring',
  handler: async (bot, msg, match) => {
    // Ne réagir que dans les groupes
    if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') return;
    
    const chatId = msg.chat.id;
    const trackerName = match[1].trim().replace(/^@/, '');
    
    // Supprimer le tracker du monitoring
    const success = await db.removeTracking(trackerName, chatId.toString());
    
    if (success) {
      bot.sendMessage(
        chatId,
        `✅ Stopped monitoring *${trackerName}* in this group.`,
        { parse_mode: 'Markdown' }
      );
    } else {
      bot.sendMessage(
        chatId,
        `❌ Error: *${trackerName}* is not being monitored in this group.`,
        { parse_mode: 'Markdown' }
      );
    }
  }
};

module.exports = removeCommand;