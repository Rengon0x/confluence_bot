// src/services/parsers/rayParser.js

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
      
      // Extract wallet address
      const walletAddress = this.extractWalletAddress(message);
      
      // Determine transaction type based on emoji
      let transactionType = null;
      if (messageText.includes('🟢 BUY') || messageText.includes('🆕🟢 BUY')) {
        transactionType = 'buy';
      } else if (messageText.includes('🔴 SELL')) {
        transactionType = 'sell';
      }
      
      // If not a buy/sell transaction, ignore
      if (!transactionType) {
        logger.info('Message type: IRRELEVANT - Not a buy or sell transaction');
        return null;
      }
      
      // Extract token symbol from first line - improved regex
      let tokenSymbol = '';
      const tokenMatch = messageText.match(/(?:🆕?🟢 BUY|🔴 SELL)\s+([A-Za-z0-9•\-\s]+?)(?:\s+on|$)/i);
      if (tokenMatch) {
        tokenSymbol = tokenMatch[1].trim();
      }
      
      // Also try to extract from hashtag if available
      const hashtagMatch = messageText.match(/\*\*#([A-Za-z0-9]+?)\*\*/);
      if (hashtagMatch && !tokenSymbol) {
        tokenSymbol = hashtagMatch[1];
      }
      
      // Extract wallet name (after 🔹, handling markdown bold)
      const walletNameMatch = messageText.match(/🔹\s*\*?\*?([^\*\n]+?)\*?\*?(?:\s|\n)/);
      const walletName = walletNameMatch ? walletNameMatch[1].trim() : 'unknown';
      logger.debug('Wallet name match: ' + (walletName || 'none'));
      logger.debug('Wallet address: ' + (walletAddress || 'none'));
      
      // Extract transaction details from the swap line - improved regex patterns
      let baseAmount = 0;
      let baseSymbol = 'SOL';
      let tokenAmount = 0;
      let usdValue = 0;
      
      if (transactionType === 'buy') {
        // BUY pattern: "swapped X SOL for Y (USD) TOKEN"
        const swapMatch = messageText.match(/swapped\s+\*?\*?([\d,.]+)\*?\*?\s+\*?\*?(SOL|ETH|USDC|USDT)\*?\*?.*?for\s+\*?\*?([\d,.]+)\*?\*?\s+\(\$([\d,.]+)\)/i);
        
        if (swapMatch) {
          baseAmount = parseFloat(swapMatch[1].replace(/,/g, ''));
          baseSymbol = swapMatch[2].toUpperCase();
          tokenAmount = parseFloat(swapMatch[3].replace(/,/g, ''));
          usdValue = parseFloat(swapMatch[4].replace(/,/g, ''));
        }
        
        // Extract token symbol from the context if not already found
        if (!tokenSymbol) {
          const tokenSymbolMatch = messageText.match(/\(\$[\d,.]+\)\s+\*?\*?([A-Za-z0-9]+)\*?\*?/);
          if (tokenSymbolMatch) {
            tokenSymbol = tokenSymbolMatch[1];
          }
        }
      } else if (transactionType === 'sell') {
        // SELL pattern: "swapped Y (USD) TOKEN for X SOL"
        const swapMatch = messageText.match(/swapped\s+\*?\*?([\d,.]+)\*?\*?\s+\(\$([\d,.]+)\)\s+\*?\*?([A-Za-z0-9]+)\*?\*?.*?for\s+\*?\*?([\d,.]+)\*?\*?\s+\*?\*?(SOL|ETH|USDC|USDT)\*?\*?/i);
        
        if (swapMatch) {
          tokenAmount = parseFloat(swapMatch[1].replace(/,/g, ''));
          usdValue = parseFloat(swapMatch[2].replace(/,/g, ''));
          if (!tokenSymbol) {
            tokenSymbol = swapMatch[3];
          }
          baseAmount = parseFloat(swapMatch[4].replace(/,/g, ''));
          baseSymbol = swapMatch[5].toUpperCase();
        }
      }
      
      // Extract market cap
      const marketCapMatch = messageText.match(/\*\*MC\*\*:\s*\$([\d,.]+)([kKmMbB])?/);
      let marketCap = 0;
      
      if (marketCapMatch) {
        const mcValue = parseFloat(marketCapMatch[1].replace(/,/g, ''));
        const mcUnit = marketCapMatch[2] ? marketCapMatch[2].toUpperCase() : '';
        
        if (mcUnit === 'K') marketCap = mcValue * 1000;
        else if (mcUnit === 'M') marketCap = mcValue * 1000000;
        else if (mcUnit === 'B') marketCap = mcValue * 1000000000;
        else marketCap = mcValue;
      }
      
      // Extract token address from backticks or last line
      let coinAddress = '';
      
      // First try to find address in backticks
      const addressMatch = messageText.match(/`([A-Za-z0-9]{32,44}(?:pump)?)`/);
      if (addressMatch) {
        coinAddress = addressMatch[1].replace(/pump$/, '');
      } else {
        // Fallback to finding address in the last line
        const lines = messageText.split('\n');
        for (let i = lines.length - 1; i >= 0; i--) {
          const line = lines[i].trim();
          if (/^[A-Za-z0-9]{32,44}(?:pump)?$/.test(line)) {
            coinAddress = line.replace(/pump$/, ''); // Remove 'pump' suffix if present
            break;
          }
        }
      }
      
      // Clean up token symbol
      tokenSymbol = this.cleanTokenSymbol(tokenSymbol);
      
      logger.debug('Token symbol: ' + tokenSymbol);
      logger.debug('Token address: ' + (coinAddress || 'none'));
      
      logger.info(`Message type: ${transactionType.toUpperCase()} | Wallet: ${walletName} | ${baseAmount} ${baseSymbol} ${transactionType === 'buy' ? '→' : '←'} ${tokenAmount} ${tokenSymbol} | MC: ${this.formatMarketCap(marketCap)} | Address: ${coinAddress || 'none'}`);
      
      // Create and return the transaction object with wallet address
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
        baseSymbol,
        walletAddress
      );
    } catch (error) {
      logger.error('Error parsing Ray message:', error);
      return null;
    }
  },
  
  /**
   * Extract wallet address from the message
   * @param {string|Object} message - Message object or text
   * @returns {string|null} - Wallet address or null
   */
  extractWalletAddress(message) {
    try {
      let messageText = typeof message === 'string' ? message : message.text;
      
      // First try to extract from the DexScreener URL with maker parameter
      const dexScreenerMatch = messageText.match(/dexscreener\.com\/solana\/[^?]+\?maker=([A-Za-z0-9]{32,44})/);
      if (dexScreenerMatch && dexScreenerMatch[1]) {
        const candidateAddress = dexScreenerMatch[1];
        if (this.isValidSolanaAddress(candidateAddress)) {
          logger.debug(`Wallet address extracted from DexScreener URL: ${candidateAddress}`);
          return candidateAddress;
        }
      }
      
      // If not found in text, try to extract from message entities
      if (typeof message === 'object' && message.entities) {
        for (const entity of message.entities) {
          if (entity.className === "MessageEntityTextUrl" && entity.url) {
            const match = entity.url.match(/dexscreener\.com\/solana\/[^?]+\?maker=([A-Za-z0-9]{32,44})/);
            if (match && match[1] && this.isValidSolanaAddress(match[1])) {
              logger.debug(`Wallet address extracted from entity URL: ${match[1]}`);
              return match[1];
            }
          }
        }
      }
      
      return null;
    } catch (error) {
      logger.error('Error extracting wallet address:', error);
      return null;
    }
  },
  
  /**
   * Clean up token symbol
   * @param {string} symbol - Token symbol to clean
   * @returns {string} - Cleaned token symbol
   */
  cleanTokenSymbol(symbol) {
    if (!symbol) return 'UNKNOWN';
    
    // Remove common suffixes and clean up
    return symbol
      .replace(/\s+on\s+.+$/i, '') // Remove "on PUMP FUN" etc.
      .replace(/\s+/g, '')
      .replace(/\(.*\)$/, '')
      .replace(/^\$/, '')
      .trim()
      .toUpperCase();
  },
  
  /**
   * Validate if a string is a valid Solana address
   * @param {string} address - Address to validate
   * @returns {boolean} - True if valid Solana address
   */
  isValidSolanaAddress(address) {
    // Solana addresses are typically 32-44 characters long and use base58 encoding
    const solanaAddressRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    return solanaAddressRegex.test(address);
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