const Transaction = require('../../models/transaction');
const logger = require('../../utils/logger');

/**
 * Parser for Defined wallet tracker messages
 */
const definedParser = {
  /**
   * Parse a Defined wallet tracker message
   * @param {string|Object} message - Message to parse
   * @returns {Transaction|null} - Extracted transaction or null
   */
  parseMessage(message) {
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
      logger.info('New Defined message detected: ' + messageText.substring(0, 100).replace(/\n/g, ' ') + '...');
      logger.debug('Full message to parse for URL: ' + messageText);
      
      // Extract wallet name (first word before the link)
      const walletNameMatch = messageText.match(/^([^\s]+)\s+\(/);
      const walletName = walletNameMatch ? walletNameMatch[1] : 'unknown';
      logger.debug('Wallet name match: ' + (walletName || 'none'));
      
      // Determine transaction type (buy or sell)
      let transactionType = null;
      if (messageText.includes('Token Buy')) {
        transactionType = 'buy';
      } else if (messageText.includes('Token Sell')) {
        transactionType = 'sell';
      }
      
      // If not a buy/sell transaction, ignore
      if (!transactionType) {
        logger.info('Message type: IRRELEVANT - Not a buy or sell transaction');
        return null;
      }
      
      // Extract token address (from the address on the next line)
      const addressMatch = messageText.match(/\n([A-Za-z0-9]{32,44})(?:pump)?\n/);
      const coinAddress = addressMatch ? addressMatch[1] : '';
      logger.debug('Token address: ' + (coinAddress || 'none'));
      
      // Parse token information based on transaction type
      let baseAmount = 0;
      let baseSymbol = 'SOL';
      let tokenAmount = 0;
      let tokenSymbol = 'unknown';
      let usdValue = 0;
      let marketCap = 0;
      
      if (transactionType === 'buy') {
        // For BUY: Sent: X SOL for Y TOKEN
        const sentMatch = messageText.match(/➡️ Sent:\s*([\d,.]+)\s*(SOL|ETH|USDC|USDT)[^\n]*\($\s*([\d,.]+)\)/);
        const receivedMatch = messageText.match(/⬅️ Received:\s*([\d,.]+)\s*([A-Z0-9]+)\s*\(/);
        
        if (sentMatch) {
          baseAmount = parseFloat(sentMatch[1].replace(/,/g, ''));
          baseSymbol = sentMatch[2].toUpperCase();
          usdValue = parseFloat(sentMatch[3].replace(/,/g, ''));
        }
        
        if (receivedMatch) {
          tokenAmount = parseFloat(receivedMatch[1].replace(/,/g, ''));
          tokenSymbol = this.normalizeTokenSymbol(receivedMatch[2]);
        }
      } else if (transactionType === 'sell') {
        // For SELL: Sent: Y TOKEN for X SOL
        const sentMatch = messageText.match(/➡️ Sent:\s*([\d,.]+)\s*([A-Z0-9]+)\s*\(/);
        const receivedMatch = messageText.match(/⬅️ Received:\s*([\d,.]+)\s*(SOL|ETH|USDC|USDT)[^\n]*\($\s*([\d,.]+)\)/);
        
        if (sentMatch) {
          tokenAmount = parseFloat(sentMatch[1].replace(/,/g, ''));
          tokenSymbol = this.normalizeTokenSymbol(sentMatch[2]);
        }
        
        if (receivedMatch) {
          baseAmount = parseFloat(receivedMatch[1].replace(/,/g, ''));
          baseSymbol = receivedMatch[2].toUpperCase();
          usdValue = parseFloat(receivedMatch[3].replace(/,/g, ''));
        }
      }
      
      // Extract market cap (FDV)
      const marketCapMatch = messageText.match(/💎 Mkt\. Cap \(FDV\):\s*\$\s*([\d,.]+)([kMB]?)/);
      if (marketCapMatch) {
        const mcValue = parseFloat(marketCapMatch[1].replace(/,/g, ''));
        marketCap = mcValue;  // Defined already gives it in raw numbers
      }
      
      logger.info(`Message type: ${transactionType.toUpperCase()} | Wallet: ${walletName} | ${baseAmount} ${baseSymbol} ${transactionType === 'buy' ? '→' : '←'} ${tokenAmount} ${tokenSymbol} | MC: ${this.formatMarketCap(marketCap)} | Address: ${coinAddress || 'none'}`);
      
      // Create and return the transaction object
      return new Transaction(
        walletName,
        transactionType,
        tokenSymbol,
        coinAddress,
        tokenAmount,
        usdValue,
        new Date(),
        marketCap,
        baseAmount,
        baseSymbol
      );
    } catch (error) {
      logger.error('Error parsing Defined message:', error);
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
    return symbol.replace(/[^\w\-]/g, '').toUpperCase();
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

module.exports = definedParser;