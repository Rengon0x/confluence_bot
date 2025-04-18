// src/bot/commands/admin/simulateUsdcCommand.js
const logger = require('../../../utils/logger');
const confluenceService = require('../../../services/confluenceService');
const telegramService = require('../../../services/telegramService');
const Transaction = require('../../../models/transaction');

/**
 * Command /simulateusdc - Simulates transactions with USDC/USDT to create a confluence
 */
const simulateUsdcCommand = {
  name: 'simulateusdc',
  regex: /\/simulateusdc(?:\s+(\d+))?(?:\s+(.+))?(?:\s+(USDC|USDT))?/i,
  description: 'Simulate transactions with USDC/USDT to create a confluence',
  handler: async (bot, msg, match) => {
    const chatId = msg.chat.id;
    const walletCount = parseInt(match[1] || "2", 10); // Number of wallets, default is 2
    const coinName = (match[2] || "TESTTOK").toUpperCase(); // Token name, default is TESTTOK
    const baseSymbol = (match[3] || "USDC").toUpperCase(); // Base symbol, default is USDC
    
    try {
      // Track if confluence is detected
      let confluenceDetected = false;
      
      // Create a fictional token ID that's consistent for the same token name
      const coinAddress = `SIM${Date.now().toString(36).slice(-6)}`;
      
      // Inform about the simulation starting
      bot.sendMessage(
        chatId,
        `🧪 <b>Starting ${baseSymbol} simulation with ${walletCount} wallets for token ${coinName} (address: ${coinAddress})</b>`,
        { parse_mode: 'HTML' }
      );
      
      // Generate transactions for multiple wallets
      for (let i = 1; i <= walletCount; i++) {
        // Create a fictional wallet with more realistic name
        const walletName = `#UsdcWallet${i}`;
        
        // Generate random values - for USDC/USDT we use different ranges
        const baseAmount = Math.floor(Math.random() * 1000) + 100; // Random USDC/USDT between 100 and 1100
        const usdValue = baseAmount; // For stablecoins, base amount = USD value
        const amount = Math.floor(Math.random() * 10000000) + 1000000; // Random token amount
        const marketCap = Math.floor(Math.random() * 400000) + 10000; // Random MarketCap between $10k and $410k
        const price = (usdValue / amount).toFixed(8); // Calculate price per token
        
        // Create a transaction
        const transaction = new Transaction(
          walletName,
          'buy', // Always buys for simulation
          coinName,
          coinAddress,
          amount,
          parseFloat(usdValue),
          new Date(),
          marketCap,
          parseFloat(baseAmount),
          baseSymbol
        );
        
        // Inject the transaction into the system
        await confluenceService.addTransaction(transaction, chatId.toString());
        
        // Log the simulation
        logger.info(`Simulated ${baseSymbol} transaction: ${walletName} bought ${transaction.amount} ${coinName} with ${baseAmount} ${baseSymbol}`);
        
        // Create a mock message with proper Chart URL including the token address
        const mockMessage = 
          `${walletName}\n` +
          `⭐️ 🟢 Swapped ${baseAmount} #${baseSymbol} ($${usdValue.toFixed(2)}) for ${amount.toLocaleString('en-US', {maximumFractionDigits: 2})} #${coinName} On #PumpSwap @ $${price} | MC: $${formatMarketCap(marketCap)}\n` +
          `#solana | Cielo | ViewTx | Chart (https://photon-sol.tinyastro.io/en/r/@cielosol/${coinAddress}pump)\n` +
          `🐴 Buy on Trojan`;
        
        // Send the mock message to the chat
        bot.sendMessage(chatId, mockMessage);
        
        // After each transaction, check if a confluence is detected
        const confluences = confluenceService.checkConfluences(chatId.toString());
        
        if (confluences && confluences.length > 0) {
          confluenceDetected = true;
          
          // Send a message to the group
          for (const confluence of confluences) {
            const formattedMessage = telegramService.formatConfluenceMessage(confluence);
            bot.sendMessage(chatId, formattedMessage, { parse_mode: 'HTML' });
          }
        }
        
        // Wait a bit between transactions to simulate separate purchases
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      // If no confluence was detected after all transactions
      if (!confluenceDetected) {
        bot.sendMessage(
          chatId,
          `⚠️ All ${walletCount} transactions processed but no confluence was detected!`,
          { parse_mode: 'HTML' }
        );
        
        // Dump transactions for debugging
        confluenceService.findTransactionsForToken(coinAddress);
      }
      
    } catch (error) {
      logger.error(`Error in ${baseSymbol} simulation: ${error.message}`);
      bot.sendMessage(
        chatId,
        `❌ Error during ${baseSymbol} simulation: ${error.message}`,
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

module.exports = simulateUsdcCommand;