// src/bot/commands/admin/sellTxCommand.js
const logger = require('../../../utils/logger');
const confluenceService = require('../../../services/confluenceService');
const telegramService = require('../../../services/telegramService');
const Transaction = require('../../../models/transaction');

/**
 * Command /selltx - Simulate a sell transaction for a specific wallet
 */
const sellTxCommand = {
  name: 'selltx',
  regex: /\/selltx\s+([^\s]+)\s+(.+)?/,
  description: 'Simulate a sell transaction for a specific wallet',
  handler: async (bot, msg, match) => {
    const chatId = msg.chat.id;
    const walletName = match[1]; // First parameter is wallet name
    const coinName = (match[2] || "TESTTOK").toUpperCase(); // Second parameter is token name (optional)
    
    try {
      // Generate realistic sell values
      const baseAmount = (Math.random() * 10 + 1).toFixed(2); // Random SOL between 1 and 11
      const baseSymbol = "SOL";
      const usdValue = (baseAmount * 130).toFixed(2); // Approximate SOL value
      const amount = Math.floor(Math.random() * 5000000) + 500000; // Token amount for selling
      const marketCap = Math.floor(Math.random() * 200000) + 10000; // Random MarketCap
      const price = (usdValue / amount).toFixed(8); // Calculate price per token
      
      // Create a transaction object
      const transaction = new Transaction(
        `#${walletName}`, // Add # prefix to match format
        'sell', // This is a sell transaction
        coinName,
        '', // coinAddress will be filled if there's a match
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
      
      // Create a mock sell message
      const mockMessage = 
        `#${walletName}\n` +
        `🔴 Swapped ${amount.toLocaleString('en-US', {maximumFractionDigits: 2})} #${coinName} ($${usdValue}) for ${baseAmount} #${baseSymbol} On #PumpSwap @ $${price} | MC: $${formatMarketCap(marketCap)}\n` +
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
      logger.error(`Error in sell simulation: ${error.message}`);
      bot.sendMessage(
        chatId,
        `❌ Error during sell simulation: ${error.message}`,
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

module.exports = sellTxCommand;