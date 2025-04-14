// src/bot/commands/user/setupCommand.js
const logger = require('../../../utils/logger');
const db = require('../../../db');
const config = require('../../../config/config');

/**
 * Commande /setup - Configure un tracker pour un groupe
 */
const setupCommand = {
  name: 'setup',
  regex: /\/setup(?:@\w+)?(?:\s+(.+))?/,
  description: 'Setup a tracker in a group',
  handler: async (bot, msg, match) => {
    // Ne réagir que dans les groupes
    if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') {
      bot.sendMessage(msg.chat.id, "This command can only be used in groups. Please add me to a group first.");
      return;
    }
    
    const chatId = msg.chat.id;
    const chatName = msg.chat.title;
    
    // Vérifier si un tracker a été spécifié
    let trackerName = match && match[1] ? match[1].trim() : null;
    
    if (!trackerName) {
      // Si aucun tracker n'est spécifié, demander d'en spécifier un
      bot.sendMessage(
        chatId,
        "Please specify which tracker bot to monitor. For example:\n" +
        `/setup CieloTrackerPrivate`
      );
      return;
    }
    
    // Nettoyer le format du nom du tracker
    trackerName = trackerName.replace(/^@/, '');
    
    // Enregistrer ce groupe pour suivre le tracker spécifié
    try {
      // Enregistrer le setup de tracking dans la base de données
      const success = await db.registerTracking(trackerName, chatId.toString(), chatName);
      
      if (success) {
        bot.sendMessage(
          chatId,
          `✅ Setup complete! I'm now monitoring *${trackerName}* in this group.\n\n` +
          `I'll alert you when multiple wallets buy or sell the same coin.\n\n` +
          `Default settings:\n` +
          `• Minimum wallets for confluence: ${config.confluence.minWallets}\n` +
          `• Time window: ${config.confluence.windowMinutes} minutes\n\n` +
          `You can change these with /settings`,
          { parse_mode: 'Markdown' }
        );
      } else {
        bot.sendMessage(
          chatId,
          `❌ Setup failed. Please try again or contact support.`
        );
      }
    } catch (error) {
      logger.error('Error in setup command:', error);
      bot.sendMessage(
        chatId,
        `❌ Setup failed: ${error.message}\n\nPlease try again or contact support.`
      );
    }
  }
};

module.exports = setupCommand;