const Transaction = require('../models/transaction');
const logger = require('../utils/logger');

/**
 * Service to parse wallet tracker Telegram messages
 */
const parserService = {
  /**
   * Parse a wallet tracker message and extract transaction information
   * @param {string} message - Message to parse
   * @returns {Transaction|null} - Extracted transaction or null if the message is not a transaction
   */
  parseTrackerMessage(message) {
    try {
      // Log the first part of the message for debugging
      logger.info('New message detected: ' + message.substring(0, 100).replace(/\n/g, ' ') + '...');
      
      // Detailed logging to debug regex matches
      logger.debug('Checking message patterns:');
      logger.debug('Contains "Swapped": ' + message.includes('Swapped'));
      logger.debug('Contains "Received": ' + message.includes('Received'));
      logger.debug('BUY pattern match: ' + !!message.match(/Swapped\s+[\d,.]+\s+#(SOL|ETH).+for\s+[\d,.]+\s+#([A-Z0-9]+)/i));
      logger.debug('SELL pattern match: ' + !!message.match(/Swapped\s+[\d,.]+\s+#([A-Z0-9]+).+for\s+[\d,.]+\s+#(SOL|ETH)/i));
      
      // Extract the wallet name (appears after # at the beginning of the message)
      const walletNameMatch = message.match(/^#([^\n]+)/);
      const walletName = walletNameMatch ? walletNameMatch[1] : null;
      logger.debug('Wallet name match: ' + (walletName || 'none'));
      
      // Extract wallet address (from profile link)
      const walletAddressMatch = message.match(/Cielo \(https:\/\/app\.cielo\.finance\/profile\/([a-zA-Z0-9]+)\)/);
      const walletAddress = walletAddressMatch ? walletAddressMatch[1] : 'unknown';
      logger.debug('Wallet address match: ' + walletAddress);
      
      // Check if this is a Swap transaction
      if (message.includes('Swapped')) {
        // BUY: If SOL/ETH is being swapped FOR a token
        if (message.match(/Swapped\s+[\d,.]+\s+#(SOL|ETH).+for\s+[\d,.]+\s+#([A-Z0-9]+)/i)) {
          // Extract base token (SOL/ETH) amount
          const baseMatch = message.match(/Swapped\s+([\d,.]+)\s+#(SOL|ETH)/i);
          const baseAmount = baseMatch ? parseFloat(baseMatch[1].replace(/,/g, '')) : 0;
          const baseSymbol = baseMatch ? baseMatch[2] : 'unknown';
          
          // Extract token symbol and amount
          const tokenMatch = message.match(/for\s+([\d,.]+)\s+#([A-Z0-9]+)/i);
          const tokenAmount = tokenMatch ? parseFloat(tokenMatch[1].replace(/,/g, '')) : 0;
          const tokenSymbol = tokenMatch ? tokenMatch[2] : 'unknown';
          
          // Extract USD value
          const usdMatch = message.match(/\$\s*([\d,.]+)/);
          const usdValue = usdMatch ? parseFloat(usdMatch[1].replace(/,/g, '')) : 0;
          
          // Extract market cap if available
          const mcMatch = message.match(/MC:\s*\$\s*([\d,.]+)([kMB]?)/);
          let marketCap = 0;
          if (mcMatch) {
            const mcValue = parseFloat(mcMatch[1].replace(/,/g, ''));
            const mcUnit = mcMatch[2] || '';
            if (mcUnit === 'k') marketCap = mcValue * 1000;
            else if (mcUnit === 'M') marketCap = mcValue * 1000000;
            else if (mcUnit === 'B') marketCap = mcValue * 1000000000;
            else marketCap = mcValue;
          }
          
          logger.info(`Message type: BUY | Wallet: ${walletName} | ${baseAmount} ${baseSymbol} → ${tokenAmount} ${tokenSymbol} | MC: ${this.formatMarketCap(marketCap)}`);
          
          return new Transaction(
            walletAddress,
            walletName,
            'buy',
            tokenSymbol,
            tokenAmount,
            usdValue,
            new Date(),
            marketCap
          );
        }
        
        // SELL: If a token is being swapped FOR SOL/ETH
        if (message.match(/Swapped\s+[\d,.]+\s+#([A-Z0-9]+).+for\s+[\d,.]+\s+#(SOL|ETH)/i)) {
          // Extract token symbol and amount
          const tokenMatch = message.match(/Swapped\s+([\d,.]+)\s+#([A-Z0-9]+)/i);
          const tokenAmount = tokenMatch ? parseFloat(tokenMatch[1].replace(/,/g, '')) : 0;
          const tokenSymbol = tokenMatch ? tokenMatch[2] : 'unknown';
          
          // Extract base token (SOL/ETH) amount
          const baseMatch = message.match(/for\s+([\d,.]+)\s+#(SOL|ETH)/i);
          const baseAmount = baseMatch ? parseFloat(baseMatch[1].replace(/,/g, '')) : 0;
          const baseSymbol = baseMatch ? baseMatch[2] : 'unknown';
          
          // Extract USD value
          const usdMatch = message.match(/\$\s*([\d,.]+)/);
          const usdValue = usdMatch ? parseFloat(usdMatch[1].replace(/,/g, '')) : 0;
          
          // Extract market cap if available
          const mcMatch = message.match(/MC:\s*\$\s*([\d,.]+)([kMB]?)/);
          let marketCap = 0;
          if (mcMatch) {
            const mcValue = parseFloat(mcMatch[1].replace(/,/g, ''));
            const mcUnit = mcMatch[2] || '';
            if (mcUnit === 'k') marketCap = mcValue * 1000;
            else if (mcUnit === 'M') marketCap = mcValue * 1000000;
            else if (mcUnit === 'B') marketCap = mcValue * 1000000000;
            else marketCap = mcValue;
          }
          
          logger.info(`Message type: SELL | Wallet: ${walletName} | ${tokenAmount} ${tokenSymbol} → ${baseAmount} ${baseSymbol} | MC: ${this.formatMarketCap(marketCap)}`);
          
          return new Transaction(
            walletAddress,
            walletName,
            'sell',
            tokenSymbol,
            tokenAmount,
            usdValue,
            new Date(),
            marketCap
          );
        }
      }
      
      // If no transaction is recognized
      logger.info('Message type: IRRELEVANT - Not a buy or sell transaction');
      return null;
    } catch (error) {
      logger.error('Error parsing message:', error);
      return null;
    }
  },
  
  /**
   * Format market cap for display
   * @param {number} marketCap - Market cap value
   * @returns {string} - Formatted market cap
   */
  formatMarketCap(marketCap) {
    if (marketCap >= 1000000000) {
      return (marketCap / 1000000000).toFixed(2) + 'B';
    } else if (marketCap >= 1000000) {
      return (marketCap / 1000000).toFixed(2) + 'M';
    } else if (marketCap >= 1000) {
      return (marketCap / 1000).toFixed(2) + 'K';
    } else {
      return marketCap.toString();
    }
  }
};

module.exports = parserService;