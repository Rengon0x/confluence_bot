// src/services/telegramService.js
const logger = require('../utils/logger');

/**
 * Service to handle Telegram interactions
 */
const telegramMessageService = {
  /**
   * Format a confluence message for Telegram
   * @param {Object} confluence - Object containing confluence data
   * @returns {string} - Formatted HTML message for Telegram
   */
  formatConfluenceMessage(confluence) {
    try {
      // The primary emoji is determined by the transaction type of the confluence
      const primaryEmoji = confluence.type === 'buy' ? '🟢' : '🔴';
      const isUpdate = confluence.isUpdate ? 'UPDATED' : 'DETECTED';
      
      let message = `${primaryEmoji} CONFLUENCE ${isUpdate} FOR $${confluence.coin}\nWallet details:\n\n`;
      
      // Group wallets by type (buy/sell)
      const buyWallets = confluence.wallets.filter(wallet => wallet.type === 'buy');
      const sellWallets = confluence.wallets.filter(wallet => wallet.type === 'sell');
      
      // Sort wallets within each group by their first transaction timestamp
      const sortWalletsByFirstTransaction = wallets => {
        return wallets.sort((a, b) => {
          // We're making the simplifying assumption that the first transaction
          // in a wallet's transactions array is the earliest one
          if (a.transactions && a.transactions.length > 0 && 
              b.transactions && b.transactions.length > 0) {
              return new Date(a.transactions[0].timestamp) - new Date(b.transactions[0].timestamp);
          }
          // If transactions are not available, fallback to timestamp property
          return new Date(a.timestamp || 0) - new Date(b.timestamp || 0);
        });
      };
      
      // Sort wallets in each group
      const sortedBuyWallets = sortWalletsByFirstTransaction(buyWallets);
      const sortedSellWallets = sortWalletsByFirstTransaction(sellWallets);
      
      // Format wallets for display
      const formatWallet = wallet => {
        // Determine if this wallet line was updated
        const updateEmoji = wallet.isUpdated ? '🔄 ' : '';
        
        // Use the wallet's transaction type for the emoji (buy or sell)
        const walletEmoji = wallet.type === 'buy' ? '🟢' : '🔴';
        
        // Format marketCap
        let formattedMC = wallet.marketCap;
        if (formattedMC >= 1000000000) {
          formattedMC = `${(formattedMC / 1000000000).toFixed(1)}B`;
        } else if (formattedMC >= 1000000) {
          formattedMC = `${(formattedMC / 1000000).toFixed(1)}M`;
        } else if (formattedMC >= 1000) {
          formattedMC = `${(formattedMC / 1000).toFixed(1)}k`;
        } else {
          formattedMC = `${formattedMC.toFixed(2)}`;
        }
        
        // Get the wallet name without the # prefix if it exists
        const displayName = wallet.walletName.replace(/^#/, '');
        
        // Format base amount (SOL/ETH)
        const baseAmount = wallet.baseAmount !== undefined && wallet.baseAmount > 0 ? 
          wallet.baseAmount.toFixed(2) : 
          "0.00";
          
        // Get base symbol, default to SOL if not specified
        const baseSymbol = wallet.baseSymbol || "SOL";
        
        return `${updateEmoji}${walletEmoji} ${displayName}: ${baseAmount}${baseSymbol}@${formattedMC} mcap`;
      };
      
      // Add buy wallets to message
      if (sortedBuyWallets.length > 0) {
        sortedBuyWallets.forEach(wallet => {
          message += formatWallet(wallet) + '\n';
        });
      }
      
      // Add a separator between buys and sells if both exist
      if (sortedBuyWallets.length > 0 && sortedSellWallets.length > 0) {
        message += '\n';
      }
      
      // Add sell wallets to message
      if (sortedSellWallets.length > 0) {
        sortedSellWallets.forEach(wallet => {
          message += formatWallet(wallet) + '\n';
        });
      }
      
      return message;
    } catch (error) {
      logger.error('Error formatting confluence message:', error);
      return `Confluence detected for ${confluence.coin}: ${confluence.wallets.length} wallets`;
    }
  }
};

module.exports = telegramMessageService;