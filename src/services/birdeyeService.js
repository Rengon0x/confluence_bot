// src/services/birdeyeService.js
const axios = require('axios');
const logger = require('../utils/logger');

/**
 * Service for interacting with Birdeye API to get token price history and ATH
 */
const birdeyeService = {
  // Birdeye API endpoint
  baseUrl: 'https://public-api.birdeye.so',
  apiKey: process.env.BIRDEYE_API_KEY || '',
  
  /**
   * Get full price history for a token in a specified time range
   * 
   * @param {string} tokenAddress - Token contract address
   * @param {number} timeFrom - Start time in Unix timestamp (seconds)
   * @param {number} timeTo - End time in Unix timestamp (seconds)
   * @param {string} resolution - Chart resolution (1m, 5m, 15m, 1H, etc.)
   * @returns {Promise<Array>} - Array of price points
   */
  async getPriceHistory(tokenAddress, timeFrom, timeTo, resolution = '5m') {
    try {
      if (!this.apiKey) {
        logger.error('BIRDEYE_API_KEY not set in environment variables');
        return null;
      }
      
      if (!tokenAddress) {
        logger.warn('No token address provided for price history');
        return null;
      }

      const url = `${this.baseUrl}/defi/history_price`;
      
      const params = {
        address: tokenAddress,
        address_type: 'token',
        type: resolution,
        time_from: timeFrom,
        time_to: timeTo
      };
      
      logger.debug(`Fetching price history for token ${tokenAddress} from ${timeFrom} to ${timeTo}`);
      
      const response = await axios.get(url, {
        params,
        headers: {
          'x-api-key': this.apiKey,
          'x-chain': 'solana'
        }
      });
      
      if (!response.data || !response.data.success || !response.data.data || !response.data.data.items) {
        logger.warn(`No valid price data returned for token ${tokenAddress}`);
        return null;
      }
      
      return response.data.data.items;
    } catch (error) {
      logger.error(`Error fetching price history from Birdeye: ${error.message}`);
      return null;
    }
  },
  
  /**
   * Find ATH (All-Time High) for a token after a specific timestamp
   * 
   * @param {string} tokenAddress - Token contract address
   * @param {number} fromTimestamp - Start timestamp in milliseconds
   * @param {number} toTimestamp - End timestamp in milliseconds (optional, defaults to now)
   * @returns {Promise<Object|null>} - ATH data or null if not found
   */
  async findATH(tokenAddress, fromTimestamp, toTimestamp = Date.now()) {
    try {
      // Convert timestamps from milliseconds to seconds for Birdeye API
      const timeFrom = Math.floor(fromTimestamp / 1000);
      const timeTo = Math.floor(toTimestamp / 1000);
      
      // Get price history
      const priceHistory = await this.getPriceHistory(tokenAddress, timeFrom, timeTo);
      
      if (!priceHistory || priceHistory.length === 0) {
        logger.warn(`No price history found for token ${tokenAddress}`);
        return null;
      }
      
      // Find the maximum price
      let maxPrice = 0;
      let maxPriceTimestamp = 0;
      
      for (const point of priceHistory) {
        if (point.value > maxPrice) {
          maxPrice = point.value;
          maxPriceTimestamp = point.unixTime;
        }
      }
      
      if (maxPrice <= 0) {
        logger.warn(`No valid prices found for token ${tokenAddress}`);
        return null;
      }
      
      // Calculate time from detection to ATH
      const timeToATHSeconds = maxPriceTimestamp - timeFrom;
      const timeToATHMinutes = timeToATHSeconds / 60;
      
      // Get the initial price (first data point)
      const initialPrice = priceHistory[0]?.value || 0;
      
      // Calculate percentage gain
      const percentageGain = initialPrice > 0
        ? ((maxPrice - initialPrice) / initialPrice) * 100
        : 0;
      
      return {
        tokenAddress,
        initialPrice,
        athPrice: maxPrice,
        athTimestamp: maxPriceTimestamp * 1000, // Convert back to milliseconds
        percentageGain,
        minutesToATH: timeToATHMinutes,
        dataPoints: priceHistory.length
      };
    } catch (error) {
      logger.error(`Error finding ATH for ${tokenAddress}: ${error.message}`);
      return null;
    }
  },
  
  /**
   * Calculate market cap from price
   * 
   * @param {number} price - Token price in USD
   * @param {number} supply - Token supply (default: 1,000,000,000)
   * @returns {number} - Market cap in USD
   */
  calculateMarketCap(price, supply = 1000000000) {
    return price * supply;
  },
  
  /**
   * Batch process ATH data for multiple tokens
   * 
   * @param {Array<Object>} tokens - Array of {tokenAddress, detectionTime} objects
   * @returns {Promise<Array<Object>>} - Array of ATH data
   */
  async batchProcessATH(tokens) {
    try {
      const results = [];
      
      // Process in smaller batches to avoid rate limits
      const batchSize = 5;
      
      for (let i = 0; i < tokens.length; i += batchSize) {
        const batch = tokens.slice(i, i + batchSize);
        
        // Process each token in the batch sequentially
        for (const token of batch) {
          const athData = await this.findATH(
            token.tokenAddress,
            token.detectionTime instanceof Date 
              ? token.detectionTime.getTime() 
              : token.detectionTime
          );
          
          if (athData) {
            // Calculate market caps
            const initialMarketCap = this.calculateMarketCap(athData.initialPrice);
            const athMarketCap = this.calculateMarketCap(athData.athPrice);
            
            results.push({
              ...token,
              athData: {
                ...athData,
                initialMarketCap,
                athMarketCap
              }
            });
            
            logger.info(`Processed ATH for ${token.tokenName}: ${athData.percentageGain.toFixed(1)}% gain after ${athData.minutesToATH.toFixed(1)} minutes`);
          }
        }
        
        // Add a delay between batches to respect rate limits
        if (i + batchSize < tokens.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
      
      return results;
    } catch (error) {
      logger.error(`Error in batch processing ATH: ${error.message}`);
      return [];
    }
  }
};

module.exports = birdeyeService;