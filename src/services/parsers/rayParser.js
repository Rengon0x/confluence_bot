const Transaction = require('../../models/transaction');
const logger = require('../../utils/logger');

/**
 * Parser for Ray wallet tracker messages
 */
const rayParser = {
  /**
   * Parse a Ray wallet tracker message
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
      logger.info('New Ray message detected: ' + messageText.substring(0, 100).replace(/\n/g, ' ') + '...');
      logger.debug('Full message to parse for URL: ' + messageText);
      
      // Determine transaction type based on emoji
      let transactionType = null;
      if (messageText.includes('🟢 BUY')) {
        transactionType = 'buy';
      } else if (messageText.includes('🔴 SELL')) {
        transactionType = 'sell';
      }
      
      // If not a buy/sell transaction, ignore
      if (!transactionType) {
        logger.info('Message type: IRRELEVANT - Not a buy or sell transaction');
        return null;
      }
      
      // Extract token symbol from first line
      const tokenMatch = messageText.match(/(?:BUY|SELL)\s+([A-Z0-9]+)/);
      const tokenSymbol = tokenMatch ? tokenMatch[1] : 'unknown';
      
      // Extract wallet name (after 🔹)
      const walletNameMatch = messageText.match(/🔹\s*([^\n]+?)\s*\(https/);
      const walletName = walletNameMatch ? walletNameMatch[1].trim() : 'unknown';
      logger.debug('Wallet name match: ' + (walletName || 'none'));
      
      // Extract transaction details from the swap line
      let baseAmount = 0;
      let baseSymbol = 'SOL';
      let tokenAmount = 0;
      let usdValue = 0;
      
      if (transactionType === 'buy') {
        // BUY pattern: "swapped X SOL for Y TOKEN"
        const swapMatch = messageText.match(/swapped\s+([\d,.]+)\s+(SOL|ETH|USDC|USDT).*?for\s+([\d,.]+)\s+\(\$([\d,.]+)\)\s+([A-Z0-9]+)/i);
        
        if (swapMatch) {
          baseAmount = parseFloat(swapMatch[1].replace(/,/g, ''));
          baseSymbol = swapMatch[2].toUpperCase();
          tokenAmount = parseFloat(swapMatch[3].replace(/,/g, ''));
          usdValue = parseFloat(swapMatch[4].replace(/,/g, ''));
          // tokenSymbol is already extracted above
        }
      } else if (transactionType === 'sell') {
        // SELL pattern: "swapped Y TOKEN for X SOL"
        const swapMatch = messageText.match(/swapped\s+([\d,.]+)\s+\(\$([\d,.]+)\)\s+([A-Z0-9]+).*?for\s+([\d,.]+)\s+(SOL|ETH|USDC|USDT)/i);
        
        if (swapMatch) {
          tokenAmount = parseFloat(swapMatch[1].replace(/,/g, ''));
          usdValue = parseFloat(swapMatch[2].replace(/,/g, ''));
          // tokenSymbol is already extracted above
          baseAmount = parseFloat(swapMatch[4].replace(/,/g, ''));
          baseSymbol = swapMatch[5].toUpperCase();
        }
      }
      
      // Extract market cap
      const marketCapMatch = messageText.match(/MC:\s*\$([\d,.]+)([kKmMbB])?/);
      let marketCap = 0;
      
      if (marketCapMatch) {
        const mcValue = parseFloat(marketCapMatch[1].replace(/,/g, ''));
        const mcUnit = marketCapMatch[2] ? marketCapMatch[2].toUpperCase() : '';
        
        if (mcUnit === 'K') marketCap = mcValue * 1000;
        else if (mcUnit === 'M') marketCap = mcValue * 1000000;
        else if (mcUnit === 'B') marketCap = mcValue * 1000000000;
        else marketCap = mcValue;
      }
      
      // Extract token address (last line of the message, it's a single line with the address)
      const lines = messageText.split('\n');
      let coinAddress = '';
      
      // Find the line that matches a typical Solana address pattern (32+ characters alphanumeric)
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (/^[A-Za-z0-9]{32,44}(?:pump)?$/.test(line)) {
          coinAddress = line.replace(/pump$/, ''); // Remove 'pump' suffix if present
          break;
        }
      }
      
      logger.debug('Token address: ' + (coinAddress || 'none'));
      
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
      logger.error('Error parsing Ray message:', error);
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

module.exports = rayParser;