const logger = require('../utils/logger');
const helpers = require('./helpers');

/**
 * Register message handler for the bot
 * @param {TelegramBot} bot - The Telegram bot instance
 */
function registerMessageHandler(bot) {
  bot.on('message', async (msg) => {
    try {
      // Ignore commands
      if (msg.text && msg.text.startsWith('/')) {
        return;
      }

      const chatId = msg.chat.id;
      
      // Si c'est un chat privé et que le message commence par @, c'est probablement un nom de tracker
      if (msg.chat.type === 'private' && msg.text && msg.text.startsWith('@')) {
        const trackerName = msg.text.trim();
        logger.debug(`User ${msg.from.username || msg.from.first_name} entered tracker: ${trackerName}`);
        
        // Envoyer les instructions de configuration
        helpers.sendSetupInstructions(bot, chatId, trackerName);
        
        // Informer l'utilisateur
        bot.sendMessage(
          chatId,
          `I've registered ${trackerName} for monitoring. Once you add me to a group and complete the setup, I'll start tracking transactions from this source.`
        );
        return;
      }
      
      // Tous les autres messages sont ignorés, car le traitement des transactions
      // est maintenant géré directement par le forwarder
      
    } catch (error) {
      logger.error('Error processing message:', error);
    }
  });
}

module.exports = registerMessageHandler;