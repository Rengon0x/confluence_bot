// src/services/parserService.js
const logger = require('../utils/logger');
const cieloParser = require('./parsers/cieloParser');
const definedParser = require('./parsers/definedParser');
const rayParser = require('./parsers/rayParser');

/**
 * Service to parse wallet tracker Telegram messages
 */
const parserService = {
  /**
   * Parse a wallet tracker message and extract transaction information
   * @param {string|Object} message - Message to parse (string or object with text property)
   * @param {string} trackerType - Type of tracker ('cielo', 'defined', 'ray')
   * @returns {Transaction|null} - Extracted transaction or null if the message is not a transaction
   */
  parseTrackerMessage(message, trackerType = 'cielo') {
    try {
      // Route to the appropriate parser based on tracker type
      switch (trackerType.toLowerCase()) {
        case 'cielo':
          return cieloParser.parseMessage(message);
        case 'defined':
          return definedParser.parseMessage(message);
        case 'ray':
          return rayParser.parseMessage(message);
        default:
          logger.warn(`Unknown tracker type: ${trackerType}, defaulting to Cielo parser`);
          return cieloParser.parseMessage(message);
      }
    } catch (error) {
      logger.error(`Error in parserService for ${trackerType}:`, error);
      return null;
    }
  },
  
  // Re-export utility functions from Cielo parser for backward compatibility
  extractUsdValue: cieloParser.extractUsdValue,
  extractMarketCap: cieloParser.extractMarketCap,
  normalizeTokenSymbol: cieloParser.normalizeTokenSymbol,
  formatMarketCap: cieloParser.formatMarketCap
};

module.exports = parserService;