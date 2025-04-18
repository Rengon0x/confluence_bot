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
      
      // Extract token address from the Chart URL - improved parsing
      let coinAddress = '';
      
      // First try to extract from Chart parenthesis format: Chart (https://...)
      const chartUrlMatch = message.match(/Chart\s*\(.*?\/([a-zA-Z0-9]+)(?:pump)?\)/i);
      if (chartUrlMatch && chartUrlMatch[1]) {
        coinAddress = chartUrlMatch[1];
        logger.debug('Token address matched from Chart URL: ' + coinAddress);
      } 
      // Try alternative formats like photon-sol.tinyastro.io URLs
      else {
        const alternativeUrlMatch = message.match(/Chart.*io\/[^\/]+\/[^\/]+\/([A-Za-z0-9]+)(?:pump)?/i);
        if (alternativeUrlMatch && alternativeUrlMatch[1]) {
          coinAddress = alternativeUrlMatch[1];
          logger.debug('Token address matched from alternative Chart URL: ' + coinAddress);
        }
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
        // Modified patterns to look for SOL/ETH/USDC/USDT
        // Look for patterns that represent buying (Base token -> Token)
        const buyPattern = /Swapped[\s\*]+([\d,.]+)[\s\*]+#(SOL|ETH|USDC|USDT).+for[\s\*]+([\d,.]+)[\s\*]+#([A-Z0-9•\-]+)/i;
        const buyMatch = message.match(buyPattern);
        
        // Look for patterns that represent selling (Token -> Base token)
        const sellPattern = /Swapped[\s\*]+([\d,.]+)[\s\*]+#([A-Z0-9•\-]+).+for[\s\*]+([\d,.]+)[\s\*]+#(SOL|ETH|USDC|USDT)/i;
        const sellMatch = message.match(sellPattern);
        
        logger.debug('BUY pattern match: ' + !!buyMatch);
        logger.debug('SELL pattern match: ' + !!sellMatch);
        
        // BUY case - Base token being swapped FOR a token
        if (buyMatch || (transactionType === 'buy' && message.includes('Swapped'))) {
          // Try different regex patterns to extract the values
          let baseAmount = 0;
          let baseSymbol = 'SOL';
          let tokenAmount = 0;
          let tokenSymbol = 'unknown';
          
          // Try to extract from the standard pattern
          if (buyMatch) {
            baseAmount = parseFloat(buyMatch[1].replace(/[^\d.]/g, ''));
            baseSymbol = buyMatch[2].toUpperCase(); // Ensure capitalization
            tokenAmount = parseFloat(buyMatch[3].replace(/[^\d.]/g, ''));
            tokenSymbol = this.normalizeTokenSymbol(buyMatch[4]);
          } 
          // Fallback to more generic extraction based on emoji and context
          else {
            // Extract base token amount - look for SOL, ETH, USDC, USDT
            const baseMatch = message.match(/Swapped[\s\*]+([\d,.]+)[\s\*]+#(SOL|ETH|USDC|USDT)/i);
            if (baseMatch) {
              baseAmount = parseFloat(baseMatch[1].replace(/[^\d.]/g, ''));
              baseSymbol = baseMatch[2].toUpperCase();
            }
            
            // Extract token symbol and amount
            const tokenMatch = message.match(/for[\s\*]+([\d,.]+)[\s\*]+#([A-Z0-9•\-]+)/i);
            if (tokenMatch) {
              tokenAmount = parseFloat(tokenMatch[1].replace(/[^\d.]/g, ''));
              tokenSymbol = this.normalizeTokenSymbol(tokenMatch[2]);
            }
          }
          
          // Extract USD value
          const usdValue = this.extractUsdValue(message);
          
          // Extract market cap if available
          const marketCap = this.extractMarketCap(message);
          
          logger.info(`Message type: BUY | Wallet: ${walletName} | ${baseAmount} ${baseSymbol} → ${tokenAmount} ${tokenSymbol} | MC: ${this.formatMarketCap(marketCap)} | Address: ${coinAddress || 'none'}`);
          
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
        
        // SELL case - Token being swapped FOR a base token
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
            baseSymbol = sellMatch[4].toUpperCase(); // Ensure capitalization
          }
          // Fallback to more generic extraction
          else {
            // Extract token amount and symbol
            const tokenMatch = message.match(/Swapped[\s\*]+([\d,.]+)[\s\*]+#([A-Z0-9•\-]+)/i);
            if (tokenMatch) {
              tokenAmount = parseFloat(tokenMatch[1].replace(/[^\d.]/g, ''));
              tokenSymbol = this.normalizeTokenSymbol(tokenMatch[2]);
            }
            
            // Extract base token (SOL/ETH/USDC/USDT) amount
            const baseMatch = message.match(/for[\s\*]+([\d,.]+)[\s\*]+#(SOL|ETH|USDC|USDT)/i);
            if (baseMatch) {
              baseAmount = parseFloat(baseMatch[1].replace(/[^\d.]/g, ''));
              baseSymbol = baseMatch[2].toUpperCase();
            }
          }
          
          // Extract USD value
          const usdValue = this.extractUsdValue(message);
          
          // Extract market cap if available
          const marketCap = this.extractMarketCap(message);
          
          logger.info(`Message type: SELL | Wallet: ${walletName} | ${tokenAmount} ${tokenSymbol} → ${baseAmount} ${baseSymbol} | MC: ${this.formatMarketCap(marketCap)} | Address: ${coinAddress || 'none'}`);
          
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
   * Extract USD value from message
   * @param {string} message - Message to parse
   * @returns {number} - Extracted USD value
   */
  extractUsdValue(message) {
    const usdMatch = message.match(/\$\s*([\d,.]+)/);
    return usdMatch ? parseFloat(usdMatch[1].replace(/,/g, '')) : 0;
  },
  
  /**
   * Extract market cap from message
   * @param {string} message - Message to parse
   * @returns {number} - Extracted market cap in numbers
   */
  extractMarketCap(message) {
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
    
    return marketCap;
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