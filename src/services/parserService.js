// src/services/parserService.js
const Transaction = require('../models/transaction');
const logger = require('../utils/logger');

/**
 * Service to parse wallet tracker Telegram messages
 */
const parserService = {
  /**
   * Parse a wallet tracker message and extract transaction information
   * @param {string|Object} message - Message to parse (string or object with text property)
   * @returns {Transaction|null} - Extracted transaction or null if the message is not a transaction
   */
  parseTrackerMessage(message) {
    try {
      // Handle case where message is an object vs a simple string
      let messageText = typeof message === 'string' ? message : message.text;
      
      // Extract URLs from message entities if they exist
      let extractedUrls = [];
      
      if (typeof message === 'object' && message.entities) {
        // Look for MessageEntityTextUrl entities which contain the URLs
        for (const entity of message.entities) {
          if (entity.className === "MessageEntityTextUrl" && entity.url) {
            extractedUrls.push(entity.url);
            logger.debug(`Found URL in TextUrl entity: ${entity.url}`);
          }
        }
      }
      
      // Log the message for debugging
      logger.info('New message detected: ' + messageText.substring(0, 100).replace(/\n/g, ' ') + '...');
      logger.debug('Full message to parse for URL: ' + messageText);
      
      // Extract wallet name
      const walletNameMatch = messageText.match(/^#([^\n]+)/);
      const walletName = walletNameMatch ? walletNameMatch[1] : 'unknown';
      logger.debug('Wallet name match: ' + (walletName || 'none'));
      
      // Extract token address from URLs
      let coinAddress = '';
      
      // 1. First, check URLs extracted from entities
      if (extractedUrls.length > 0) {
        for (const url of extractedUrls) {
          // Look for Chart URLs containing the address (photon-sol.tinyastro.io)
          const photonMatch = url.match(/photon-sol\.tinyastro\.io\/en\/r\/@cielosol\/([A-Za-z0-9]+)(?:pump)?/i);
          if (photonMatch && photonMatch[1]) {
            coinAddress = photonMatch[1];
            logger.debug('Token address matched from Photon URL: ' + coinAddress);
            break;
          }
          
          // Also check for Trojan bot URLs which also contain the token address
          const trojanMatch = url.match(/nestor_trojanbot\?start=d-cielo-([A-Za-z0-9]+)(?:pump)?/i);
          if (trojanMatch && trojanMatch[1]) {
            coinAddress = trojanMatch[1];
            logger.debug('Token address matched from Trojan URL: ' + coinAddress);
            break;
          }
        }
      }
      
      // 2. If nothing found in entities, try with the old method on text
      if (!coinAddress) {
        // Try various patterns in the text
        const patterns = [
          /Chart.*?photon-sol\.tinyastro\.io\/en\/r\/@cielosol\/([A-Za-z0-9]+)(?:pump)?/i,
          /Chart\s*\(.*?\/([a-zA-Z0-9]+)(?:pump)?\)/i,
          /trojanbot\?start=d-cielo-([A-Za-z0-9]+)(?:pump)?/i,
          /@cielosol\/([A-Za-z0-9]{20,50})(?:pump)?/i
        ];
        
        for (const pattern of patterns) {
          const match = messageText.match(pattern);
          if (match && match[1]) {
            coinAddress = match[1];
            logger.debug(`Token address matched using text pattern: ${coinAddress}`);
            break;
          }
        }
      }
      
      // Log the final extracted address
      logger.debug('Final extracted token address: ' + (coinAddress || 'none'));
      
      // Determine transaction type based on emoji
      let transactionType = null;
      if (messageText.includes('🟢')) {
        transactionType = 'buy';
      } else if (messageText.includes('🔴')) {
        transactionType = 'sell';
      }
      
      // Check if this is a Swap transaction
      if (messageText.includes('Swapped')) {
        // Modified patterns to look for SOL/ETH/USDC/USDT
        // Look for patterns that represent buying (Base token -> Token)
        const buyPattern = /Swapped[\s\*]+([\d,.]+)[\s\*]+#(SOL|ETH|USDC|USDT).+for[\s\*]+([\d,.]+)[\s\*]+#([A-Z0-9•\-]+)/i;
        const buyMatch = messageText.match(buyPattern);
        
        // Look for patterns that represent selling (Token -> Base token)
        const sellPattern = /Swapped[\s\*]+([\d,.]+)[\s\*]+#([A-Z0-9•\-]+).+for[\s\*]+([\d,.]+)[\s\*]+#(SOL|ETH|USDC|USDT)/i;
        const sellMatch = messageText.match(sellPattern);
        
        logger.debug('BUY pattern match: ' + !!buyMatch);
        logger.debug('SELL pattern match: ' + !!sellMatch);
        
        // BUY case - Base token being swapped FOR a token
        if (buyMatch || (transactionType === 'buy' && messageText.includes('Swapped'))) {
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
            const baseMatch = messageText.match(/Swapped[\s\*]+([\d,.]+)[\s\*]+#(SOL|ETH|USDC|USDT)/i);
            if (baseMatch) {
              baseAmount = parseFloat(baseMatch[1].replace(/[^\d.]/g, ''));
              baseSymbol = baseMatch[2].toUpperCase();
            }
            
            // Extract token symbol and amount
            const tokenMatch = messageText.match(/for[\s\*]+([\d,.]+)[\s\*]+#([A-Z0-9•\-]+)/i);
            if (tokenMatch) {
              tokenAmount = parseFloat(tokenMatch[1].replace(/[^\d.]/g, ''));
              tokenSymbol = this.normalizeTokenSymbol(tokenMatch[2]);
            }
          }
          
          // Extract USD value
          const usdValue = this.extractUsdValue(messageText);
          
          // Extract market cap if available
          const marketCap = this.extractMarketCap(messageText);
          
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
        if (sellMatch || (transactionType === 'sell' && messageText.includes('Swapped'))) {
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
            const tokenMatch = messageText.match(/Swapped[\s\*]+([\d,.]+)[\s\*]+#([A-Z0-9•\-]+)/i);
            if (tokenMatch) {
              tokenAmount = parseFloat(tokenMatch[1].replace(/[^\d.]/g, ''));
              tokenSymbol = this.normalizeTokenSymbol(tokenMatch[2]);
            }
            
            // Extract base token (SOL/ETH/USDC/USDT) amount
            const baseMatch = messageText.match(/for[\s\*]+([\d,.]+)[\s\*]+#(SOL|ETH|USDC|USDT)/i);
            if (baseMatch) {
              baseAmount = parseFloat(baseMatch[1].replace(/[^\d.]/g, ''));
              baseSymbol = baseMatch[2].toUpperCase();
            }
          }
          
          // Extract USD value
          const usdValue = this.extractUsdValue(messageText);
          
          // Extract market cap if available
          const marketCap = this.extractMarketCap(messageText);
          
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