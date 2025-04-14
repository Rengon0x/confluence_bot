// src/bot/commands/user/startCommand.js
const config = require('../../../config/config');
const logger = require('../../../utils/logger');

/**
 * Commande /start - Initialise le bot en chat privé
 */
const startCommand = {
  name: 'start',
  regex: /\/start/,
  description: 'Start the bot in private chat',
  handler: async (bot, msg) => {
    const chatId = msg.chat.id;
    const firstName = msg.from.first_name;
    
    // Vérifier si c'est un chat de groupe
    if (msg.chat.type !== 'private') {
      // Informer l'utilisateur d'utiliser la commande en privé
      bot.sendMessage(
        chatId,
        `Hi ${firstName}! The /start command is meant to be used in a private chat. Please message me directly @${config.telegram.botUsername} and send /start there to configure the bot properly.`
      );
      return;
    }
    
    // Fonctionnalité pour le chat privé
    bot.sendMessage(
      chatId,
      `👋 Hi ${firstName}! I can detect when multiple wallets buy or sell the same coin.\n\n` +
      `Please enter the username of your wallet tracker (with @ symbol), for example:\n` +
      `@CieloTrackerPrivate_bot`
    );
  }
};

module.exports = startCommand;