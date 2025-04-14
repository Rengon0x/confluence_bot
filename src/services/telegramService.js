const logger = require('../utils/logger');
const config = require('../config/config');

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
      const emoji = confluence.type === 'buy' ? '🟢 BUY' : '🔴 SELL';
      const action = confluence.type === 'buy' ? 'bought' : 'sold';
      
      let message = `<b>${emoji} CONFLUENCE DETECTED</b>\n\n`;
      message += `<b>${confluence.count}</b> wallets ${action} <b>${confluence.coin}</b> `;
      if (confluence.coinAddress) {
        message += `(ID: ${confluence.coinAddress.substring(0, 8)}...) `;
      }
      message += `in the last ${config.confluence.windowMinutes} minutes\n\n`;
      
      if (confluence.totalAmount) {
        message += `<b>Total amount:</b> ${confluence.totalAmount.toLocaleString()} ${confluence.coin}\n`;
      }
      
      if (confluence.totalUsdValue) {
        message += `<b>Total value:</b> ${confluence.totalUsdValue.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}\n`;
      }
      
      if (confluence.avgMarketCap > 0) {
        let formattedMC = confluence.avgMarketCap;
        if (formattedMC >= 1000000000) {
          formattedMC = `${(formattedMC / 1000000000).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}B`;
        } else if (formattedMC >= 1000000) {
          formattedMC = `${(formattedMC / 1000000).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}M`;
        } else if (formattedMC >= 1000) {
          formattedMC = `${(formattedMC / 1000).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}K`;
        } else {
          formattedMC = `${formattedMC.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
        }
        message += `<b>Market Cap:</b> ${formattedMC}\n\n`;
      } else {
        message += '\n';
      }
      
      message += `<b>Wallet details:</b>\n`;
      
      // Sort wallets by descending amount
      const sortedWallets = [...confluence.wallets].sort((a, b) => (b.usdValue || 0) - (a.usdValue || 0));
      
      sortedWallets.forEach((wallet, index) => {
        message += `${index + 1}. <code>${wallet.walletName}</code>: `;
        
        if (wallet.amount) {
          const formattedAmount = wallet.amount >= 10000 
            ? wallet.amount.toLocaleString(undefined, {maximumFractionDigits: 0})
            : wallet.amount.toLocaleString(undefined, {maximumFractionDigits: 2});
          message += `${formattedAmount} ${confluence.coin}`;
        }
        
        if (wallet.usdValue) {
          message += ` (${wallet.usdValue.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})})`;
        }
        
        message += '\n';
      });
      
      return message;
    } catch (error) {
      logger.error('Error formatting confluence message:', error);
      return `Confluence detected for ${confluence.coin}: ${confluence.wallets.length} wallets`;
    }
  }
};

module.exports = telegramMessageService;