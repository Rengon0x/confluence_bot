// src/bot/commands/user/stopCommand.js
const logger = require('../../../utils/logger');
const db = require('../../../db');

/**
 * Commande /stop - Arrête de surveiller les trackers dans un groupe
 */
const stopCommand = {
  name: 'stop',
  regex: /\/stop/,
  description: 'Stop monitoring all trackers in this group',
  handler: async (bot, msg) => {
    // Ne réagir que dans les groupes
    if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') return;
    
    const chatId = msg.chat.id;
    const chatName = msg.chat.title;
    
    // Obtenir tous les trackers pour ce groupe
    const trackers = await db.getGroupTrackers(chatId.toString());
    
    if (!trackers || trackers.length === 0) {
      bot.sendMessage(
        chatId,
        "No active monitoring found in this group. Use /setup to start monitoring."
      );
      return;
    }
    
    // Supprimer tous les trackers
    let allRemoved = true;
    for (const tracker of trackers) {
      const success = await db.removeTracking(tracker.trackerName, chatId.toString());
      if (!success) allRemoved = false;
    }
    
    if (allRemoved) {
      bot.sendMessage(
        chatId,
        "🛑 All monitoring has been deactivated in this group.\n" +
        "To reactivate, use the /setup command with a tracker name."
      );
      logger.info(`Monitoring deactivated in group: ${chatName} (${chatId})`);
    } else {
      bot.sendMessage(
        chatId,
        "⚠️ Some trackers could not be removed. Please try again or use /remove for specific trackers."
      );
    }
  }
};

module.exports = stopCommand;