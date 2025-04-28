// src/services/parsers/definedParser.js

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
      
      // Extract wallet address
      const walletAddress = this.extractWalletAddress(message);
      
      // Extract wallet name - typically at beginning of message before colon
      const walletNameMatch = messageText.match(/^([^:\n]+):/);
      const walletName = walletNameMatch ? walletNameMatch[1].trim() : 'unknown';
      logger.debug('Wallet name match: ' + (walletName || 'none'));
      logger.debug('Wallet address: ' + (walletAddress || 'none'));
      
      // Determine transaction type - Buy or Sell
      let transactionType = null;
      if (messageText.includes('Token Buy')) {
        transactionType = 'buy';
      } else if (messageText.includes('Token Sell')) {
        transactionType = 'sell';
      }
      
      logger.debug('Transaction type: ' + (transactionType || 'none'));
      
      // If not a buy/sell transaction, ignore
      if (!transactionType) {
        return null;
      }
      
      // Extract coin address - usually found in backticks
      let coinAddress = '';
      const addressMatch = messageText.match(/`([A-Za-z0-9]{32,44})`/);
      if (addressMatch && addressMatch[1]) {
        coinAddress = addressMatch[1];
        logger.debug('Coin address matched from backticks: ' + coinAddress);
      }
      
      // Extract sent and received amounts
      let sentAmount = 0;
      let sentSymbol = '';
      let receivedAmount = 0;
      let receivedSymbol = '';
      
      // For Defined format, parse 'Sent' and 'Received' lines
      const sentMatch = messageText.match(/➡️\s*Sent:\s*([\d.,]+)\s*([A-Z0-9a-z•\-\s]+)/i);
      if (sentMatch) {
        sentAmount = parseFloat(sentMatch[1].replace(/,/g, ''));
        sentSymbol = sentMatch[2].trim();
        logger.debug(`Sent: ${sentAmount} ${sentSymbol}`);
      }
      
      const receivedMatch = messageText.match(/⬅️\s*Received:\s*([\d.,]+)\s*([A-Z0-9a-z•\-\s]+)/i);
      if (receivedMatch) {
        receivedAmount = parseFloat(receivedMatch[1].replace(/,/g, ''));
        receivedSymbol = receivedMatch[2].trim();
        logger.debug(`Received: ${receivedAmount} ${receivedSymbol}`);
      }
      
      // If received data is missing, try to parse token info from other parts of the message
      if (!receivedSymbol || receivedSymbol === '') {
        // Try extracting from message context around the token address
        const tokenInfoMatch = messageText.match(/Token\s+(Buy|Sell)[\s\S]*?([A-Z0-9]{2,10})\s*\(/i);
        if (tokenInfoMatch) {
          receivedSymbol = tokenInfoMatch[2].trim();
          logger.debug(`Extracted token symbol from context: ${receivedSymbol}`);
        }
        
        // If still not found and we have a coin address, try to extract from message entities
        if ((!receivedSymbol || receivedSymbol === '') && coinAddress && typeof message === 'object' && message.entities) {
          for (const entity of message.entities) {
            if (entity.className === "MessageEntityTextUrl" && 
                entity.url && 
                entity.url.includes('defined.fi/sol/') && 
                !entity.url.includes('So11111111111111111111111111111111111111112')) {
              // Extract token symbol from the entity text
              const tokenText = messageText.substring(entity.offset, entity.offset + entity.length).trim();
              if (tokenText && tokenText.length > 0 && tokenText.length <= 10) {
                receivedSymbol = tokenText;
                logger.debug(`Extracted token symbol from URL entity: ${receivedSymbol}`);
                break;
              }
            }
          }
        }
      }
      
      // If received amount is missing, try to extract from USD value
      if (receivedAmount === 0 || isNaN(receivedAmount)) {
        // Try to find amount in parentheses after a USD value
        const amountMatch = messageText.match(/\((?:\$|USD)[\d.,]+\)\s*(?:for)?\s*([\d.,]+)/i);
        if (amountMatch) {
          receivedAmount = parseFloat(amountMatch[1].replace(/,/g, ''));
          logger.debug(`Extracted token amount from context: ${receivedAmount}`);
        }
      }
      
      // Extract USD value
      let usdValue = 0;
      const usdMatch = messageText.match(/(?:\$|USD)\s*([\d.,]+)/i);
      if (usdMatch) {
        usdValue = parseFloat(usdMatch[1].replace(/,/g, ''));
        logger.debug('USD value: ' + usdValue);
      }
      
      // Extract market cap
      const marketCapMatch = messageText.match(/(?:💎|Mkt\.?\s*Cap|MC)(?:\s*\(FDV\))?:\s*(?:\$|USD)?\s*([\d.,]+)([kKmMbB]?)/i);
      const marketCap = marketCapMatch ? this.parseMarketCap(marketCapMatch[1], marketCapMatch[2]) : 0;
      logger.debug('Market cap: ' + marketCap);
      
      // Determine token symbol and amount based on transaction type
      let tokenSymbol, tokenAmount, baseAmount, baseSymbol;
      
      if (transactionType === 'buy') {
        // For buys: Base currency (SOL/USDC) -> Token
        tokenSymbol = receivedSymbol ? this.cleanTokenSymbol(receivedSymbol) : 'UNKNOWN';
        tokenAmount = receivedAmount;
        baseSymbol = sentSymbol ? this.cleanTokenSymbol(sentSymbol) : 'SOL';
        baseAmount = sentAmount;
      } else { // sell
        // For sells: Token -> Base currency (SOL/USDC)
        tokenSymbol = sentSymbol ? this.cleanTokenSymbol(sentSymbol) : 'UNKNOWN';
        tokenAmount = sentAmount;
        baseSymbol = receivedSymbol ? this.cleanTokenSymbol(receivedSymbol) : 'SOL';
        baseAmount = receivedAmount;
      }
      
      // If we still don't have a token symbol but have a coin address, 
      // use the last part of the coin address as a placeholder
      if ((tokenSymbol === 'UNKNOWN' || !tokenSymbol) && coinAddress) {
        tokenSymbol = coinAddress.substring(0, 4).toUpperCase();
        logger.debug(`Using prefix of coin address as token symbol: ${tokenSymbol}`);
      }
      
      logger.info(`Creating transaction: ${transactionType} ${tokenAmount} ${tokenSymbol} for ${baseAmount} ${baseSymbol}`);
      
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
      logger.error('Error parsing Defined message:', error);
      return null;
    }
  },
  
  /**
   * Extract wallet address from the message
   * @param {string|Object} message - Message text or object
   * @returns {string|null} - Wallet address or null
   */
  extractWalletAddress(message) {
    try {
      // First check if message is an object with entities
      if (typeof message === 'object' && message.entities) {
        // Look for wallet address in TextUrl entities
        for (const entity of message.entities) {
          if (entity.className === "MessageEntityTextUrl" && entity.url) {
            // Check for Solscan address URL
            const match = entity.url.match(/solscan\.io\/address\/([A-Za-z0-9]{32,44})/);
            if (match && match[1] && this.isValidSolanaAddress(match[1])) {
              logger.debug(`Wallet address extracted from entity URL: ${match[1]}`);
              return match[1];
            }
          }
        }
      }
      
      // Fallback to parsing the message text
      let messageText = typeof message === 'string' ? message : message.text;
      
      // Check for Solscan address URL in text
      const addressMatch = messageText.match(/solscan\.io\/address\/([A-Za-z0-9]{32,44})/);
      if (addressMatch && addressMatch[1]) {
        const candidateAddress = addressMatch[1];
        if (this.isValidSolanaAddress(candidateAddress)) {
          logger.debug(`Wallet address extracted from text URL: ${candidateAddress}`);
          return candidateAddress;
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
    
    // Remove common decorations and clean up
    return symbol
      .replace(/\s+/g, '')  // Remove spaces
      .replace(/\(.*\)$/, '') // Remove anything in parentheses at end
      .replace(/^\$/, '')   // Remove leading $ sign
      .replace(/[^\w\-•]/g, '') // Remove non-word characters except dash and bullet
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
   * Parse market cap string into a number
   * @param {string} value - Market cap value as string
   * @param {string} suffix - Market cap suffix (k/m/b)
   * @returns {number} - Parsed market cap value
   */
  parseMarketCap(value, suffix = '') {
    try {
      const numValue = parseFloat(value.replace(/[^0-9.]/g, ''));
      
      if (!suffix) {
        return numValue;
      }
      
      suffix = suffix.toLowerCase();
      
      if (suffix === 'k') {
        return numValue * 1000;
      } else if (suffix === 'm') {
        return numValue * 1000000;
      } else if (suffix === 'b') {
        return numValue * 1000000000;
      }
      
      return numValue;
    } catch (error) {
      logger.error('Error parsing market cap:', error);
      return 0;
    }
  }
};

module.exports = definedParser;