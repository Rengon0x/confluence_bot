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
      const emoji = confluence.type === 'buy' ? '🟢' : '🔴';
      const isUpdate = confluence.isUpdate ? 'UPDATED' : 'DETECTED';
      
      let message = `${emoji} CONFLUENCE ${isUpdate} FOR $${confluence.coin}\n\n`;
      message += `Wallet details:\n`;
      
      // Use wallets in their order of appearance
      const wallets = confluence.wallets;
      
      wallets.forEach((wallet) => {
        // Determine if this wallet line was updated
        const updateEmoji = wallet.isUpdated ? '🔄 ' : '';
        
        // Determine emoji based on transaction type
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
        
        // Format base amount (SOL/ETH)
        const baseAmount = wallet.baseAmount !== undefined ? 
          wallet.baseAmount.toFixed(2) : 
          "0.00";
          
        // Get base symbol, default to SOL if not specified
        const baseSymbol = wallet.baseSymbol || "SOL";
        
        message += `${updateEmoji}${walletEmoji} ${wallet.walletName}: ${baseAmount}${baseSymbol}@${formattedMC} mcap\n`;
      });
      
      return message;
    } catch (error) {
      logger.error('Error formatting confluence message:', error);
      return `Confluence detected for ${confluence.coin}: ${confluence.wallets.length} wallets`;
    }
  }
};

module.exports = telegramMessageService;