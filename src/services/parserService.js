// src/services/parserService.js
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
      // Log the message for debugging
      logger.info('New message detected: ' + message.substring(0, 100).replace(/\n/g, ' ') + '...');
      
      // Extract wallet name (appears after # at beginning of message)
      const walletNameMatch = message.match(/^#([^\n]+)/);
      const walletName = walletNameMatch ? walletNameMatch[1] : 'unknown';
      logger.debug('Wallet name match: ' + (walletName || 'none'));
      
      // Extract token address from the Chart URL
      let coinAddress = '';
      const chartUrlMatch = message.match(/Chart\s*\(.*?\/([a-zA-Z0-9]+)(?:pump)?\)/i);
      if (chartUrlMatch) {
        coinAddress = chartUrlMatch[1];
        logger.debug('Token address match: ' + coinAddress);
      }
      
      // Determine transaction type based on emoji
      let transactionType = null;
      if (message.includes('🟢')) {
        transactionType = 'buy';
      } else if (message.includes('🔴')) {
        transactionType = 'sell';
      }
      
      // Check if this is a Swap transaction
      if (message.includes('Swapped')) {
        // Look for patterns that represent buying (SOL/ETH -> Token)
        const buyPattern = /Swapped[\s\*]+([\d,.]+)[\s\*]+#(SOL|ETH).+for[\s\*]+([\d,.]+)[\s\*]+#([A-Z0-9•\-]+)/i;
        const buyMatch = message.match(buyPattern);
        
        // Look for patterns that represent selling (Token -> SOL/ETH)
        const sellPattern = /Swapped[\s\*]+([\d,.]+)[\s\*]+#([A-Z0-9•\-]+).+for[\s\*]+([\d,.]+)[\s\*]+#(SOL|ETH)/i;
        const sellMatch = message.match(sellPattern);
        
        logger.debug('BUY pattern match: ' + !!buyMatch);
        logger.debug('SELL pattern match: ' + !!sellMatch);
        
        // BUY case - SOL/ETH being swapped FOR a token
        if (buyMatch || (transactionType === 'buy' && message.includes('Swapped'))) {
          // Try different regex patterns to extract the values
          let baseAmount = 0;
          let baseSymbol = 'SOL';
          let tokenAmount = 0;
          let tokenSymbol = 'unknown';
          
          // Try to extract from the standard pattern
          if (buyMatch) {
            baseAmount = parseFloat(buyMatch[1].replace(/[^\d.]/g, ''));
            baseSymbol = buyMatch[2];
            tokenAmount = parseFloat(buyMatch[3].replace(/[^\d.]/g, ''));
            tokenSymbol = this.normalizeTokenSymbol(buyMatch[4]);
          } 
          // Fallback to more generic extraction based on emoji and context
          else {
            // Extract base token (SOL/ETH) amount
            const baseMatch = message.match(/Swapped[\s\*]+([\d,.]+)[\s\*]+#(SOL|ETH)/i);
            if (baseMatch) {
              baseAmount = parseFloat(baseMatch[1].replace(/[^\d.]/g, ''));
              baseSymbol = baseMatch[2];
            }
            
            // Extract token symbol and amount
            const tokenMatch = message.match(/for[\s\*]+([\d,.]+)[\s\*]+#([A-Z0-9•\-]+)/i);
            if (tokenMatch) {
              tokenAmount = parseFloat(tokenMatch[1].replace(/[^\d.]/g, ''));
              tokenSymbol = this.normalizeTokenSymbol(tokenMatch[2]);
            }
          }
          
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
            walletName,
            'buy',
            tokenSymbol,
            coinAddress,
            tokenAmount,
            usdValue,
            new Date(),
            marketCap,
            baseAmount,
            baseSymbol
          );
        }
        
        // SELL case - Token being swapped FOR SOL/ETH
        if (sellMatch || (transactionType === 'sell' && message.includes('Swapped'))) {
          // Extract values for sell transaction
          let tokenAmount = 0;
          let tokenSymbol = 'unknown';
          let baseAmount = 0;
          let baseSymbol = 'SOL';
          
          // Try to extract from the standard pattern
          if (sellMatch) {
            tokenAmount = parseFloat(sellMatch[1].replace(/[^\d.]/g, ''));
            tokenSymbol = this.normalizeTokenSymbol(sellMatch[2]);
            baseAmount = parseFloat(sellMatch[3].replace(/[^\d.]/g, ''));
            baseSymbol = sellMatch[4];
          }
          // Fallback to more generic extraction
          else {
            // Extract token amount and symbol
            const tokenMatch = message.match(/Swapped[\s\*]+([\d,.]+)[\s\*]+#([A-Z0-9•\-]+)/i);
            if (tokenMatch) {
              tokenAmount = parseFloat(tokenMatch[1].replace(/[^\d.]/g, ''));
              tokenSymbol = this.normalizeTokenSymbol(tokenMatch[2]);
            }
            
            // Extract base token (SOL/ETH) amount
            const baseMatch = message.match(/for[\s\*]+([\d,.]+)[\s\*]+#(SOL|ETH)/i);
            if (baseMatch) {
              baseAmount = parseFloat(baseMatch[1].replace(/[^\d.]/g, ''));
              baseSymbol = baseMatch[2];
            }
          }
          
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
            walletName,
            'sell',
            tokenSymbol,
            coinAddress,
            tokenAmount,
            usdValue,
            new Date(),
            marketCap,
            baseAmount,
            baseSymbol
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
   * Normalize token symbol to ensure consistent storage and lookup
   * @param {string} symbol - Token symbol to normalize
   * @returns {string} - Normalized token symbol
   */
  normalizeTokenSymbol(symbol) {
    // Keep alphanumeric and some common special characters
    // then convert to uppercase for consistent comparison
    return symbol.replace(/[^\w\-•]/g, '').toUpperCase();
  },
  
  /**
   * Format market cap for display
   * @param {number} marketCap - Market cap value
   * @returns {string} - Formatted market cap
   */
  formatMarketCap(marketCap) {
    if (marketCap >= 1000000000) {
      return (marketCap / 1000000000).toFixed(1) + 'B';
    } else if (marketCap >= 1000000) {
      return (marketCap / 1000000).toFixed(1) + 'M';
    } else if (marketCap >= 1000) {
      return (marketCap / 1000).toFixed(1) + 'k';
    } else {
      return marketCap.toString();
    }
  }
};

module.exports = parserService;