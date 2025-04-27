const Transaction = require('../../models/transaction');
const logger = require('../../utils/logger');

/**
 * Parser for Cielo wallet tracker messages
 */
const cieloParser = {
  /**
   * Parse a Cielo wallet tracker message
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
      logger.info('New message detected: ' + messageText.substring(0, 100).replace(/\n/g, ' ') + '...');


      logger.debug('Full message to parse for URL: ' + messageText);

      // Extract wallet address first
      const walletAddress = this.extractWalletAddress(message);
      
      // Extract wallet name
      const walletNameMatch = messageText.match(/^#([^\n]+)/);
      const walletName = walletNameMatch ? walletNameMatch[1] : 'unknown';
      logger.debug('Wallet name match: ' + (walletName || 'none'));
      logger.debug('Wallet address: ' + (walletAddress || 'none'));

      
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
        const buyPattern = /Swapped[\s\*]+([\d,.]+)[\s\*]+#(SOL|ETH|USDC|USDT).+for[\s\*]+([\d,.]+)[\s\*]+#([A-Z0-9•\-]+)/i;
        const buyMatch = messageText.match(buyPattern);
        
        const sellPattern = /Swapped[\s\*]+([\d,.]+)[\s\*]+#([A-Z0-9•\-]+).+for[\s\*]+([\d,.]+)[\s\*]+#(SOL|ETH|USDC|USDT)/i;
        const sellMatch = messageText.match(sellPattern);
        
        // BUY case
        if (buyMatch || (transactionType === 'buy' && messageText.includes('Swapped'))) {
          let baseAmount = 0;
          let baseSymbol = 'SOL';
          let tokenAmount = 0;
          let tokenSymbol = 'unknown';
          
          if (buyMatch) {
            baseAmount = parseFloat(buyMatch[1].replace(/[^\d.]/g, ''));
            baseSymbol = buyMatch[2].toUpperCase();
            tokenAmount = parseFloat(buyMatch[3].replace(/[^\d.]/g, ''));
            tokenSymbol = this.normalizeTokenSymbol(buyMatch[4]);
          } else {
            const baseMatch = messageText.match(/Swapped[\s\*]+([\d,.]+)[\s\*]+#(SOL|ETH|USDC|USDT)/i);
            if (baseMatch) {
              baseAmount = parseFloat(baseMatch[1].replace(/[^\d.]/g, ''));
              baseSymbol = baseMatch[2].toUpperCase();
            }
            
            const tokenMatch = messageText.match(/for[\s\*]+([\d,.]+)[\s\*]+#([A-Z0-9•\-]+)/i);
            if (tokenMatch) {
              tokenAmount = parseFloat(tokenMatch[1].replace(/[^\d.]/g, ''));
              tokenSymbol = this.normalizeTokenSymbol(tokenMatch[2]);
            }
          }
          
          const usdValue = this.extractUsdValue(messageText);
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
            baseSymbol,
            walletAddress
          );
        }
        
        // SELL case
        if (sellMatch || (transactionType === 'sell' && messageText.includes('Swapped'))) {
          let tokenAmount = 0;
          let tokenSymbol = 'unknown';
          let baseAmount = 0;
          let baseSymbol = 'SOL';
          
          if (sellMatch) {
            tokenAmount = parseFloat(sellMatch[1].replace(/[^\d.]/g, ''));
            tokenSymbol = this.normalizeTokenSymbol(sellMatch[2]);
            baseAmount = parseFloat(sellMatch[3].replace(/[^\d.]/g, ''));
            baseSymbol = sellMatch[4].toUpperCase();
          } else {
            const tokenMatch = messageText.match(/Swapped[\s\*]+([\d,.]+)[\s\*]+#([A-Z0-9•\-]+)/i);
            if (tokenMatch) {
              tokenAmount = parseFloat(tokenMatch[1].replace(/[^\d.]/g, ''));
              tokenSymbol = this.normalizeTokenSymbol(tokenMatch[2]);
            }
            
            const baseMatch = messageText.match(/for[\s\*]+([\d,.]+)[\s\*]+#(SOL|ETH|USDC|USDT)/i);
            if (baseMatch) {
              baseAmount = parseFloat(baseMatch[1].replace(/[^\d.]/g, ''));
              baseSymbol = baseMatch[2].toUpperCase();
            }
          }
          
          const usdValue = this.extractUsdValue(messageText);
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
            baseSymbol,
            walletAddress
          );
        }
      }
      
      logger.info('Message type: IRRELEVANT - Not a buy or sell transaction');
      return null;
    } catch (error) {
      logger.error('Error parsing Cielo message:', error);
      return null;
    }
  },
  
  extractUsdValue(message) {
    const usdMatch = message.match(/\$\s*([\d,.]+)/);
    return usdMatch ? parseFloat(usdMatch[1].replace(/,/g, '')) : 0;
  },
  
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

  extractWalletAddress(message) {
    try {
      let walletAddress = null;
      let messageText = typeof message === 'string' ? message : message.text;
      
      // 1. Try to extract from Cielo profile URL
      const cieloProfileMatch = messageText.match(/https:\/\/app\.cielo\.finance\/profile\/([A-Za-z0-9]+)/i);
      if (cieloProfileMatch && cieloProfileMatch[1]) {
        const candidateAddress = cieloProfileMatch[1];
        if (this.isValidSolanaAddress(candidateAddress)) {
          walletAddress = candidateAddress;
          logger.debug(`Wallet address extracted from Cielo profile URL: ${walletAddress}`);
        }
      }
      
      // 2. If not found, try to extract from message entities
      if (!walletAddress && typeof message === 'object' && message.entities) {
        for (const entity of message.entities) {
          if (entity.className === "MessageEntityTextUrl" && entity.url) {
            const match = entity.url.match(/https:\/\/app\.cielo\.finance\/profile\/([A-Za-z0-9]+)/i);
            if (match && match[1] && this.isValidSolanaAddress(match[1])) {
              walletAddress = match[1];
              logger.debug(`Wallet address extracted from entity URL: ${walletAddress}`);
              break;
            }
          }
        }
      }
      
      return walletAddress;
    } catch (error) {
      logger.error('Error extracting wallet address:', error);
      return null;
    }
  },

  isValidSolanaAddress(address) {
    // Solana addresses are typically 32-44 characters long and use base58 encoding
    const solanaAddressRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    return solanaAddressRegex.test(address);
  },  
  
  normalizeTokenSymbol(symbol) {
    return symbol.replace(/[^\w\-•]/g, '').toUpperCase();
  },
  
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

module.exports = cieloParser;