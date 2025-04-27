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
      
      // Extract wallet address from Solscan URL
      const walletAddress = this.extractWalletAddress(messageText);
      
      // Extract wallet name
      const walletNameMatch = messageText.match(/^([^\n:]+):/);
      const walletName = walletNameMatch ? walletNameMatch[1].trim() : 'unknown';
      logger.debug('Wallet name match: ' + (walletName || 'none'));
      logger.debug('Wallet address: ' + (walletAddress || 'none'));
      
      // Determine transaction type
      let transactionType = null;
      if (messageText.includes('Token Buy')) {
        transactionType = 'buy';
      } else if (messageText.includes('Token Sell')) {
        transactionType = 'sell';
      }
      
      logger.debug('Transaction type: ' + (transactionType || 'none'));
      
      if (!transactionType) {
        return null;
      }
      
      // Extract coin address from the message (in backticks)
      let coinAddress = '';
      const addressMatch = messageText.match(/`([A-Za-z0-9]{32,44})`/);
      if (addressMatch && addressMatch[1]) {
        coinAddress = addressMatch[1];
        logger.debug('Coin address matched from backticks: ' + coinAddress);
      }
      
      // Extract sent/received amounts
      let sentAmount = 0;
      let sentSymbol = '';
      let receivedAmount = 0;
      let receivedSymbol = '';
      
      // For Defined format, extract amounts from the main text
      const sentMatch = messageText.match(/➡️ Sent: ([\d,.]+) ([A-Z0-9a-z•\-\s]+?)(?:\n|$|\s*\()/);
      if (sentMatch) {
        sentAmount = parseFloat(sentMatch[1].replace(/,/g, ''));
        sentSymbol = sentMatch[2].trim();
        logger.debug(`Sent: ${sentAmount} ${sentSymbol}`);
      }
      
      // Check if there's a Received line or extract from token info URLs
      const receivedMatch = messageText.match(/⬅️ Received: ([\d,.]+) ([A-Z0-9a-z•\-\s]+?)(?:\n|$|\s*\()/);
      if (receivedMatch) {
        receivedAmount = parseFloat(receivedMatch[1].replace(/,/g, ''));
        receivedSymbol = receivedMatch[2].trim();
        logger.debug(`Received: ${receivedAmount} ${receivedSymbol}`);
      } else {
        // Try to extract from the URLs or other context
        // Look for token amount and symbol in the URLs or other parts of the message
        const definedMatch = messageText.match(/www\.defined\.fi\/sol\/([^?]+)/);
        if (definedMatch) {
          // Extract token symbol from the URL or other context
          // This is a fallback when the received line is not present
          
          // For buys, we need to determine what's being bought
          if (transactionType === 'buy') {
            // Extract from USD value context if available
            const usdContextMatch = messageText.match(/\(([\d,.]+)\)\s*([A-Z0-9a-z]+)\s*\(\$([\d,.]+)\)/);
            if (usdContextMatch) {
              receivedAmount = parseFloat(usdContextMatch[1].replace(/,/g, ''));
              receivedSymbol = usdContextMatch[2];
            } else {
              // Last resort: try to extract from after the address
              const afterAddressMatch = messageText.match(/`[A-Za-z0-9]+`[^a-zA-Z0-9]*([\d,.]+)\s*([A-Z0-9a-z]+)/);
              if (afterAddressMatch) {
                receivedAmount = parseFloat(afterAddressMatch[1].replace(/,/g, ''));
                receivedSymbol = afterAddressMatch[2];
              }
            }
          }
        }
      }
      
      // Extract USD value - can be after Sent or Received
      let usdValue = 0;
      const usdMatch = messageText.match(/\(?\$([\d,.]+)\)?/);
      if (usdMatch) {
        usdValue = parseFloat(usdMatch[1].replace(/,/g, ''));
        logger.debug('USD value: ' + usdValue);
      }
      
      // Extract market cap
      const marketCapMatch = messageText.match(/💎 Mkt\. Cap \(FDV\): \$([0-9,.kMB]+)/);
      const marketCap = marketCapMatch ? this.parseMarketCap(marketCapMatch[1]) : 0;
      logger.debug('Market cap: ' + marketCap);
      
      // IMPORTANT: Determine the correct token symbol based on transaction type
      let tokenSymbol, tokenAmount, baseAmount, baseSymbol;
      
      if (transactionType === 'buy') {
        // For buys: Base currency (SOL) -> Token
        // If we don't have receivedSymbol, try to extract from URLs
        if (!receivedSymbol) {
          // Try to extract token symbol from Defined.fi URL
          const tokenUrlMatch = messageText.match(/www\.defined\.fi\/sol\/[^?]+\?.*quoteToken=token1/);
          if (tokenUrlMatch) {
            // Extract from the link text or other context
            const linkTextMatch = messageText.match(/\)\s*([A-Z0-9a-z]+)\s*\(/);
            if (linkTextMatch) {
              receivedSymbol = linkTextMatch[1];
            }
          }
        }
        
        tokenSymbol = receivedSymbol ? receivedSymbol.toUpperCase() : 'UNKNOWN';
        tokenAmount = receivedAmount || 0;
        baseSymbol = sentSymbol ? sentSymbol.toUpperCase() : 'SOL';
        baseAmount = sentAmount;
      } else if (transactionType === 'sell') {
        // For sells: Token -> Base currency (SOL)
        tokenSymbol = sentSymbol ? sentSymbol.toUpperCase() : 'UNKNOWN';
        tokenAmount = sentAmount;
        baseSymbol = receivedSymbol ? receivedSymbol.toUpperCase() : 'SOL';
        baseAmount = receivedAmount;
      }
      
      // Clean up token symbols
      tokenSymbol = this.cleanTokenSymbol(tokenSymbol);
      baseSymbol = this.cleanTokenSymbol(baseSymbol);
      
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
   * @param {string} message - Message text
   * @returns {string|null} - Wallet address or null
   */
  extractWalletAddress(message) {
    try {
      // Extract from Solscan address URL
      const addressMatch = message.match(/https:\/\/solscan\.io\/address\/([A-Za-z0-9]{32,44})/);
      if (addressMatch && addressMatch[1]) {
        const candidateAddress = addressMatch[1];
        if (this.isValidSolanaAddress(candidateAddress)) {
          logger.debug(`Wallet address extracted from Solscan URL: ${candidateAddress}`);
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
    
    // Remove common suffixes and clean up
    return symbol
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
   * Parse market cap string into a number
   * @param {string} marketCapStr - Market cap string with suffixes
   * @returns {number} - Parsed market cap value
   */
  parseMarketCap(marketCapStr) {
    try {
      const value = parseFloat(marketCapStr.replace(/[^0-9.]/g, ''));
      
      if (marketCapStr.includes('k') || marketCapStr.includes('K')) {
        return value * 1000;
      } else if (marketCapStr.includes('M')) {
        return value * 1000000;
      } else if (marketCapStr.includes('B')) {
        return value * 1000000000;
      }
      
      return value;
    } catch (error) {
      logger.error('Error parsing market cap:', error);
      return 0;
    }
  }
};

module.exports = definedParser;