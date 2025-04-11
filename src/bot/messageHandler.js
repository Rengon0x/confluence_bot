const logger = require('../utils/logger');
const parserService = require('../services/parserService');
const confluenceService = require('../services/confluenceService');
const telegramMessageService = require('../services/telegramMessageService');

/**
 * Register message handler for transaction detection
 * @param {TelegramBot} bot - The Telegram bot instance
 */
function registerMessageHandler(bot) {
  bot.on('message', async (msg) => {
    try {
      // Ignore commands and service messages
      if (msg.text && msg.text.startsWith('/')) {
        return;
      }

      const chatId = msg.chat.id;
      
      // Debug log the message
      logger.debug('Processing message content:', msg.text);

      // Parse the message to extract transaction information
      const transaction = parserService.parseTrackerMessage(msg.text);
      
      // If it's not a buy or sell transaction, ignore
      if (!transaction || (transaction.type !== 'buy' && transaction.type !== 'sell')) {
        logger.debug('Ignoring message - not a valid transaction');
        return;
      }

      // Add the transaction to the confluence detection service
      confluenceService.addTransaction(transaction);
      logger.info(`Transaction added to confluence tracker: ${transaction.type.toUpperCase()} ${transaction.amount} ${transaction.coin}`);

      // Check for confluences
      const confluences = confluenceService.checkConfluences();
      logger.debug(`Checked for confluences. Found: ${confluences.length}`);
      
      // If there are confluences, send alerts
      if (confluences && confluences.length > 0) {
        for (const confluence of confluences) {
          const message = telegramMessageService.formatConfluenceMessage(confluence);
          bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
          logger.info(`Confluence detected for ${confluence.coin}: ${confluence.wallets.length} wallets`);
        }
      }
    } catch (error) {
      logger.error('Error processing message:', error);
    }
  });
}

module.exports = registerMessageHandler;