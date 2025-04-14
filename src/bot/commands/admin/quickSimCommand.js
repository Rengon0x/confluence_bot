// src/bot/commands/admin/quickSimCommand.js
const logger = require('../../../utils/logger');
const confluenceService = require('../../../services/confluenceService');
const telegramService = require('../../../services/telegramService');
const Transaction = require('../../../models/transaction');

/**
 * Command /quicksim - Quickly simulates a predefined confluence
 */
const quickSimCommand = {
  name: 'quicksim',
  regex: /\/quicksim/,
  description: 'Quickly simulate a predefined confluence',
  handler: async (bot, msg) => {
    const chatId = msg.chat.id;
    
    try {
      // Create fictional token ID and name
      const coinName = `QTEST${Date.now().toString(36).slice(-4).toUpperCase()}`;
      const coinAddress = `QSIM${Date.now().toString(36).slice(-6)}`;
      
      // Create predefined transactions with realistic values
      const transactions = [
        {
          walletName: "#QuickWallet1", 
          amount: 7817769, 
          usdValue: 1293,
          baseAmount: 9.9,
          baseSymbol: "SOL",
          marketCap: 165400,
          price: 0.00017
        },
        {
          walletName: "#QuickWallet2", 
          amount: 5429000, 
          usdValue: 782,
          baseAmount: 6.0,
          baseSymbol: "SOL",
          marketCap: 178600,
          price: 0.00014
        },
        {
          walletName: "#QuickWallet3", 
          amount: 11358873, 
          usdValue: 737,
          baseAmount: 5.63,
          baseSymbol: "SOL",
          marketCap: 64900,
          price: 0.000065
        }
      ];
      
      bot.sendMessage(
        chatId,
        `🧪 <b>Starting quick simulation with token ${coinName}</b>`,
        { parse_mode: 'HTML' }
      );
      
      // Add each transaction
      for (const tx of transactions) {
        const transaction = new Transaction(
          tx.walletName,
          'buy',
          coinName,
          coinAddress,
          tx.amount,
          tx.usdValue,
          new Date(),
          tx.marketCap,
          tx.baseAmount,
          tx.baseSymbol
        );
        
        await confluenceService.addTransaction(transaction, chatId.toString());
        
        // Create a mock message that closely resembles real messages
        const mockMessage = 
          `${tx.walletName}\n` +
          `⭐️ 🟢 Swapped ${tx.baseAmount} #${tx.baseSymbol} ($${tx.usdValue.toFixed(2)}) for ${tx.amount.toLocaleString('en-US', {maximumFractionDigits: 2})} #${coinName} On #PumpSwap @ $${tx.price} | MC: $${formatMarketCap(tx.marketCap)}\n` +
          `#solana | Cielo | ViewTx | Chart\n` +
          `🐴 Buy on Trojan`;
        
        // Send the mock message to the chat
        bot.sendMessage(chatId, mockMessage);
        
        // Small delay between transactions
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // Check for confluences
      const confluences = confluenceService.checkConfluences(chatId.toString());
      
      if (confluences && confluences.length > 0) {
        // Send a message to the group
        for (const confluence of confluences) {
          const formattedMessage = telegramService.formatConfluenceMessage(confluence);
          bot.sendMessage(chatId, formattedMessage, { parse_mode: 'HTML' });
        }
      } else {
        bot.sendMessage(
          chatId,
          `⚠️ No confluence detected after quick simulation!`,
          { parse_mode: 'HTML' }
        );
        
        // Dump transactions for debugging
        confluenceService.findTransactionsForToken(coinName);
      }
      
    } catch (error) {
      logger.error(`Error in quick simulation: ${error.message}`);
      bot.sendMessage(
        chatId,
        `❌ Error during quick simulation: ${error.message}`,
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

module.exports = quickSimCommand;