// src/bot/commands/admin/buyTxCommand.js
const logger = require('../../../utils/logger');
const confluenceService = require('../../../services/confluenceService');
const telegramService = require('../../../services/telegramService');
const Transaction = require('../../../models/transaction');

/**
 * Command /buytx - Simulate an additional buy transaction for a specific wallet
 */
const buyTxCommand = {
  name: 'buytx',
  regex: /\/buytx\s+([^\s]+)\s+(.+)?/,
  description: 'Simulate an additional buy transaction for a specific wallet',
  handler: async (bot, msg, match) => {
    const chatId = msg.chat.id;
    const walletName = match[1]; // First parameter is wallet name
    const coinName = (match[2] || "TESTTOK").toUpperCase(); // Second parameter is token name (optional)
    
    try {
      // Generate realistic buy values
      const baseAmount = (Math.random() * 15 + 5).toFixed(2); // Random SOL between 5 and 20
      const baseSymbol = "SOL";
      const usdValue = (baseAmount * 130).toFixed(2); // Approximate SOL value
      const amount = Math.floor(Math.random() * 8000000) + 2000000; // Random token amount
      const marketCap = Math.floor(Math.random() * 250000) + 20000; // Random MarketCap
      const price = (usdValue / amount).toFixed(8); // Calculate price per token
      
      // Create a transaction object
      const transaction = new Transaction(
        `#${walletName}`,
        'buy',
        coinName,
        '', // Will be filled if matching coin found
        amount,
        parseFloat(usdValue),
        new Date(),
        marketCap,
        parseFloat(baseAmount),
        baseSymbol
      );
      
      // Find existing transactions for this token to get its address
      let foundCoinAddress = '';
      
      // Search through the cache keys
      const keys = confluenceService.transactionsCache.keys();
      for (const key of keys) {
        if (key.includes(coinName)) {
          const transactions = confluenceService.transactionsCache.get(key) || [];
          if (transactions.length > 0 && transactions[0].coinAddress) {
            foundCoinAddress = transactions[0].coinAddress;
            transaction.coinAddress = foundCoinAddress;
            break;
          }
        }
      }
      
      // Add the transaction
      await confluenceService.addTransaction(transaction, chatId.toString());
      
      // Create a mock buy message
      const mockMessage = 
        `#${walletName}\n` +
        `⭐️ 🟢 Swapped ${baseAmount} #${baseSymbol} ($${usdValue}) for ${amount.toLocaleString('en-US', {maximumFractionDigits: 2})} #${coinName} On #PumpSwap @ $${price} | MC: $${formatMarketCap(marketCap)}\n` +
        `#solana | Cielo | ViewTx | Chart\n` +
        `🐴 Buy on Trojan`;
      
      // Send the mock message
      bot.sendMessage(chatId, mockMessage);
      
      // Check for confluence updates
      const confluences = confluenceService.checkConfluences(chatId.toString());
      if (confluences && confluences.length > 0) {
        for (const confluence of confluences) {
          const formattedMessage = telegramService.formatConfluenceMessage(confluence);
          bot.sendMessage(chatId, formattedMessage, { parse_mode: 'HTML' });
        }
      }
      
    } catch (error) {
      logger.error(`Error in additional buy simulation: ${error.message}`);
      bot.sendMessage(
        chatId,
        `❌ Error during additional buy simulation: ${error.message}`,
        { parse_mode: 'HTML' }
      );
    }
  }
};

/**
 * Format market cap for display in K, M, B format
 * @param {number} marketCap - The market cap value
 * @returns {string} - Formatted market cap
 */
function formatMarketCap(marketCap) {
  if (marketCap >= 1000000000) {
    return `${(marketCap / 1000000000).toFixed(1)}B`;
  } else if (marketCap >= 1000000) {
    return `${(marketCap / 1000000).toFixed(1)}M`;
  } else if (marketCap >= 1000) {
    return `${(marketCap / 1000).toFixed(1)}k`;
  } else {
    return marketCap.toString();
  }
}

module.exports = buyTxCommand;