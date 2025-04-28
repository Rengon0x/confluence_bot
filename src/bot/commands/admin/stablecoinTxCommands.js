// src/bot/commands/admin/stablecoinTxCommands.js
const logger = require('../../../utils/logger');
const confluenceService = require('../../../services/confluenceService');
const telegramService = require('../../../services/telegramService');
const Transaction = require('../../../models/transaction');

/**
 * Command /buytxusdc - Simulate an additional buy transaction with USDC 
 */
const buyTxUsdcCommand = {
  name: 'buytxusdc',
  regex: /\/buytxusdc\s+([^\s]+)\s+(.+)?/,
  description: 'Simulate an additional buy transaction with USDC for a specific wallet',
  handler: async (bot, msg, match) => {
    const chatId = msg.chat.id;
    const walletName = match[1]; // First parameter is wallet name
    const coinName = (match[2] || "TESTTOK").toUpperCase(); // Second parameter is token name (optional)
    
    try {
      // Generate realistic buy values for USDC
      const baseAmount = Math.floor(Math.random() * 1000) + 200; // Random USDC between 200 and 1200
      const baseSymbol = "USDC";
      const usdValue = baseAmount; // For stablecoins, base amount = USD value
      const amount = Math.floor(Math.random() * 8000000) + 2000000; // Random token amount
      const marketCap = Math.floor(Math.random() * 250000) + 20000; // Random MarketCap
      const price = (usdValue / amount).toFixed(8); // Calculate price per token
      
      // Find existing transactions for this token to get its address and maintain same key
      let foundCoinAddress = '';
      let existingTransactionType = 'buy'; // Default to buy if no match found
      
      // Search through the cache keys more effectively
      const cacheKeys = confluenceService.transactionsCache.keys();
      logger.debug(`Searching for token ${coinName} among ${cacheKeys.length} keys`);
      
      // First pass - search for exact matches in transaction data
      for (const key of cacheKeys) {
        // Filter only keys from this chat group
        if (key.startsWith(`${chatId.toString()}_`)) {
          const transactions = confluenceService.transactionsCache.get(key) || [];
          
          // Look for matching transactions
          for (const tx of transactions) {
            if (tx.coin === coinName) {
              logger.debug(`Found match for ${coinName} in key ${key}`);
              foundCoinAddress = tx.coinAddress || '';
              existingTransactionType = key.split('_')[1]; // Extract type from key (buy/sell)
              logger.debug(`Using existing type: ${existingTransactionType}, coin address: ${foundCoinAddress}`);
              break;
            }
          }
          
          if (foundCoinAddress) break; // Stop searching if found
        }
      }
      
      // If still not found, try a broader search
      if (!foundCoinAddress) {
        for (const key of cacheKeys) {
          // Only look in this group's keys
          if (key.startsWith(`${chatId.toString()}_`)) {
            // Check if the key itself contains the token name
            if (key.includes(coinName)) {
              logger.debug(`Found potential match in key name: ${key}`);
              const transactions = confluenceService.transactionsCache.get(key) || [];
              if (transactions.length > 0) {
                foundCoinAddress = transactions[0].coinAddress || '';
                existingTransactionType = key.split('_')[1]; // Extract type from key (buy/sell)
                logger.debug(`Using broader match type: ${existingTransactionType}, coin address: ${foundCoinAddress}`);
                break;
              }
            }
          }
        }
      }
      
      // Create a transaction object using found data if available
      const transaction = new Transaction(
        `#${walletName}`,
        existingTransactionType, // Use the type from existing transactions to maintain coherence
        coinName,
        foundCoinAddress,
        amount,
        parseFloat(usdValue),
        new Date(),
        marketCap,
        parseFloat(baseAmount),
        baseSymbol
      );
      
      logger.info(`Creating buy transaction with USDC for ${walletName} ${coinName} with type ${existingTransactionType}, address: ${foundCoinAddress || 'none'}`);
      
      // Add the transaction
      await confluenceService.addTransaction(transaction, chatId.toString());
      
      // Create a mock buy message
      const mockMessage = 
        `#${walletName}\n` +
        `⭐️ 🟢 Swapped ${baseAmount} #${baseSymbol} ($${usdValue.toFixed(2)}) for ${amount.toLocaleString('en-US', {maximumFractionDigits: 2})} #${coinName} On #PumpSwap @ $${price} | MC: $${formatMarketCap(marketCap)}\n` +
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
      } else {
        logger.warn(`No confluences detected after adding USDC transaction for ${coinName}`);
        confluenceService.findTransactionsForToken(coinName);
      }
      
    } catch (error) {
      logger.error(`Error in additional USDC buy simulation: ${error.message}`);
      bot.sendMessage(
        chatId,
        `❌ Error during additional USDC buy simulation: ${error.message}`,
        { parse_mode: 'HTML' }
      );
    }
  }
};

/**
 * Command /buytxusdt - Simulate an additional buy transaction with USDT
 */
const buyTxUsdtCommand = {
  name: 'buytxusdt',
  regex: /\/buytxusdt\s+([^\s]+)\s+(.+)?/,
  description: 'Simulate an additional buy transaction with USDT for a specific wallet',
  handler: async (bot, msg, match) => {
    const chatId = msg.chat.id;
    const walletName = match[1]; // First parameter is wallet name
    const coinName = (match[2] || "TESTTOK").toUpperCase(); // Second parameter is token name (optional)
    
    try {
      // Generate realistic buy values for USDT
      const baseAmount = Math.floor(Math.random() * 1000) + 200; // Random USDT between 200 and 1200
      const baseSymbol = "USDT";
      const usdValue = baseAmount; // For stablecoins, base amount = USD value
      const amount = Math.floor(Math.random() * 8000000) + 2000000; // Random token amount
      const marketCap = Math.floor(Math.random() * 250000) + 20000; // Random MarketCap
      const price = (usdValue / amount).toFixed(8); // Calculate price per token
      
      // Find existing transactions for this token to get its address and maintain same key
      let foundCoinAddress = '';
      let existingTransactionType = 'buy'; // Default to buy if no match found
      
      // Search through the cache keys
      const cacheKeys = confluenceService.transactionsCache.keys();
      
      // First pass - search for exact matches in transaction data
      for (const key of cacheKeys) {
        if (key.startsWith(`${chatId.toString()}_`)) {
          const transactions = confluenceService.transactionsCache.get(key) || [];
          
          for (const tx of transactions) {
            if (tx.coin === coinName) {
              foundCoinAddress = tx.coinAddress || '';
              existingTransactionType = key.split('_')[1];
              break;
            }
          }
          
          if (foundCoinAddress) break;
        }
      }
      
      // If still not found, try a broader search
      if (!foundCoinAddress) {
        for (const key of cacheKeys) {
          if (key.startsWith(`${chatId.toString()}_`) && key.includes(coinName)) {
            const transactions = confluenceService.transactionsCache.get(key) || [];
            if (transactions.length > 0) {
              foundCoinAddress = transactions[0].coinAddress || '';
              existingTransactionType = key.split('_')[1];
              break;
            }
          }
        }
      }
      
      // Create a transaction object
      const transaction = new Transaction(
        `#${walletName}`,
        existingTransactionType,
        coinName,
        foundCoinAddress,
        amount,
        parseFloat(usdValue),
        new Date(),
        marketCap,
        parseFloat(baseAmount),
        baseSymbol
      );
      
      // Add the transaction
      await confluenceService.addTransaction(transaction, chatId.toString());
      
      // Create a mock buy message
      const mockMessage = 
        `#${walletName}\n` +
        `⭐️ 🟢 Swapped ${baseAmount} #${baseSymbol} ($${usdValue.toFixed(2)}) for ${amount.toLocaleString('en-US', {maximumFractionDigits: 2})} #${coinName} On #PumpSwap @ $${price} | MC: $${formatMarketCap(marketCap)}\n` +
        `#solana | Cielo | ViewTx | Chart\n` +
        `🐴 Buy on Trojan`;
      
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
      logger.error(`Error in additional USDT buy simulation: ${error.message}`);
      bot.sendMessage(
        chatId,
        `❌ Error during additional USDT buy simulation: ${error.message}`,
        { parse_mode: 'HTML' }
      );
    }
  }
};

/**
 * Command /selltxusdc - Simulate a sell transaction with USDC
 */
const sellTxUsdcCommand = {
  name: 'selltxusdc',
  regex: /\/selltxusdc\s+([^\s]+)\s+(.+)?/,
  description: 'Simulate a sell transaction with USDC for a specific wallet',
  handler: async (bot, msg, match) => {
    const chatId = msg.chat.id;
    const walletName = match[1]; // First parameter is wallet name
    const coinName = (match[2] || "TESTTOK").toUpperCase(); // Second parameter is token name (optional)
    
    try {
      // Generate realistic sell values for USDC
      const baseAmount = Math.floor(Math.random() * 800) + 100; // Random USDC between 100 and 900
      const baseSymbol = "USDC";
      const usdValue = baseAmount; // For stablecoins, base amount = USD value
      const amount = Math.floor(Math.random() * 5000000) + 500000; // Token amount for selling
      const marketCap = Math.floor(Math.random() * 200000) + 10000; // Random MarketCap
      const price = (usdValue / amount).toFixed(8); // Calculate price per token
      
      // Find existing transactions for this token
      let foundCoinAddress = '';
      
      // Search through the cache keys
      const cacheKeys = confluenceService.transactionsCache.keys();
      
      for (const key of cacheKeys) {
        if (key.startsWith(`${chatId.toString()}_`)) {
          const transactions = confluenceService.transactionsCache.get(key) || [];
          
          for (const tx of transactions) {
            if (tx.coin === coinName) {
              foundCoinAddress = tx.coinAddress || '';
              break;
            }
          }
          
          if (foundCoinAddress) break;
        }
      }
      
      // If still not found, try a broader search
      if (!foundCoinAddress) {
        for (const key of cacheKeys) {
          if (key.startsWith(`${chatId.toString()}_`) && key.includes(coinName)) {
            const transactions = confluenceService.transactionsCache.get(key) || [];
            if (transactions.length > 0) {
              foundCoinAddress = transactions[0].coinAddress || '';
              break;
            }
          }
        }
      }
      
      // Create a transaction object
      const transaction = new Transaction(
        `#${walletName}`,
        'sell', // This is a sell transaction
        coinName,
        foundCoinAddress,
        amount,
        parseFloat(usdValue),
        new Date(),
        marketCap,
        parseFloat(baseAmount),
        baseSymbol
      );
      
      // Add the transaction
      await confluenceService.addTransaction(transaction, chatId.toString());
      
      // Create a mock sell message
      const mockMessage = 
        `#${walletName}\n` +
        `🔴 Swapped ${amount.toLocaleString('en-US', {maximumFractionDigits: 2})} #${coinName} ($${usdValue.toFixed(2)}) for ${baseAmount} #${baseSymbol} On #PumpSwap @ $${price} | MC: $${formatMarketCap(marketCap)}\n` +
        `#solana | Cielo | ViewTx | Chart\n` +
        `🐴 Buy on Trojan`;
      
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
      logger.error(`Error in USDC sell simulation: ${error.message}`);
      bot.sendMessage(
        chatId,
        `❌ Error during USDC sell simulation: ${error.message}`,
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

module.exports = {
  buyTxUsdcCommand,
  buyTxUsdtCommand,
  sellTxUsdcCommand
};