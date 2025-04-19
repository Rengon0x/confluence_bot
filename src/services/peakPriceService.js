// src/services/peakPriceService.js
const axios = require('axios');
const logger = require('../utils/logger');

/**
 * Service for finding peak token prices and calculating market caps after confluence detection
 */
const peakPriceService = {
  // CODEX API endpoint
  apiUrl: 'https://api.codex.so/graphql',
  apiKey: process.env.CODEX_API_KEY || '',
  
  // Constants
  solanaNetworkId: 103,  // Solana network ID for CODEX API
  defaultTokenSupply: 1000000000, // Assumed constant supply for all tokens
  
  /**
   * Find the peak market cap of a token after detection with high-frequency sampling
   * 
   * @param {string} tokenAddress - Token contract address
   * @param {Date|number} detectionTime - Detection timestamp (Date object or Unix timestamp)
   * @param {number} initialMarketCap - Initial market cap at detection time
   * @returns {Promise<Object>} - Peak market cap data with percentage gain
   */
  async findPeakMarketCap(tokenAddress, detectionTime, initialMarketCap) {
    try {
      if (!this.apiKey) {
        logger.error('CODEX_API_KEY not set in environment variables');
        return null;
      }
      
      if (!tokenAddress) {
        logger.warn('No token address provided for peak market cap search');
        return null;
      }
      
      // Convert detection time to Unix timestamp
      const detectionTimestamp = typeof detectionTime === 'object' 
        ? Math.floor(detectionTime.getTime() / 1000)
        : Math.floor(detectionTime / 1000);
      
      // High-frequency time offsets (in seconds) optimized for memecoin volatility
      // Dense in early minutes to catch rapid movements
      const timeOffsets = [
        0,            // Detection moment
        120,          // +2 min
        300,          // +5 min
        600,          // +10 min
        900,          // +15 min
        1200,         // +20 min
        1800,         // +30 min
        2700,         // +45 min
        3600,         // +1h
        5400,         // +1h30
        7200,         // +2h
        10800,        // +3h
        14400,        // +4h
        21600,        // +6h
        43200,        // +12h
        86400         // +24h
      ];
      
      // Generate timestamps to check
      const checkpointTimestamps = timeOffsets.map(offset => detectionTimestamp + offset);
      
      // Get prices at these timestamps
      const priceData = await this.getTokenPrices(tokenAddress, checkpointTimestamps);
      
      if (!priceData || priceData.length === 0) {
        logger.warn(`Could not get price data for token ${tokenAddress}`);
        return null;
      }
      
      // Get initial price for reference
      const initialPrice = priceData.find(p => p.timestamp === detectionTimestamp);
      
      if (!initialPrice || initialPrice.priceUsd <= 0) {
        logger.warn(`Could not get valid initial price for token ${tokenAddress}`);
        return null;
      }
      
      // Calculate market caps for each price point
      const marketCapData = priceData.map(price => {
        // Calculate market cap (price * constant supply)
        const marketCap = price.priceUsd * this.defaultTokenSupply;
        
        // Calculate time offset from detection in minutes
        const minutesFromDetection = (price.timestamp - detectionTimestamp) / 60;
        
        return {
          timestamp: price.timestamp,
          price: price.priceUsd,
          marketCap: marketCap,
          minutesFromDetection: minutesFromDetection
        };
      });
      
      // Find the highest market cap
      let highestMarketCap = marketCapData[0].marketCap;
      let highestMarketCapPoint = marketCapData[0];
      
      for (const point of marketCapData) {
        if (point.marketCap > highestMarketCap) {
          highestMarketCap = point.marketCap;
          highestMarketCapPoint = point;
        }
      }
      
      // If the highest market cap is at one of the endpoints, check if we need to 
      // explore further to find the true peak
      if (highestMarketCapPoint === marketCapData[marketCapData.length - 1]) {
        // The highest market cap was at our last checkpoint (24h), 
        // we may want to look further in a real implementation
        logger.debug(`Peak market cap for ${tokenAddress} is at the last checkpoint (24h), may extend further`);
      }
      
      // If the highest market cap is in the early minutes (< 30 min), 
      // we should check more granularly around that point
      if (highestMarketCapPoint.minutesFromDetection < 30 && highestMarketCapPoint.minutesFromDetection > 0) {
        logger.debug(`Peak market cap detected in early minutes (${highestMarketCapPoint.minutesFromDetection.toFixed(1)}min), performing granular check`);
        
        // Find the time points before and after the current highest
        const pointIndex = marketCapData.indexOf(highestMarketCapPoint);
        const beforePoint = pointIndex > 0 ? marketCapData[pointIndex - 1] : null;
        const afterPoint = pointIndex < marketCapData.length - 1 ? marketCapData[pointIndex + 1] : null;
        
        // If we have both before and after points, create additional checkpoints between them
        if (beforePoint && afterPoint) {
          const startTime = beforePoint.timestamp;
          const endTime = afterPoint.timestamp;
          const timeRange = endTime - startTime;
          
          // If the range is significant enough (> 4 minutes), add more checkpoints
          if (timeRange > 240) {
            // Create 4 intermediate points
            const intermediatePoints = [];
            for (let i = 1; i <= 4; i++) {
              intermediatePoints.push(startTime + Math.floor((timeRange * i) / 5));
            }
            
            // Get prices at these intermediate points
            const intermediatePriceData = await this.getTokenPrices(tokenAddress, intermediatePoints);
            
            if (intermediatePriceData && intermediatePriceData.length > 0) {
              // Calculate market caps for intermediate points
              const intermediateMarketCaps = intermediatePriceData.map(price => {
                const marketCap = price.priceUsd * this.defaultTokenSupply;
                const minutesFromDetection = (price.timestamp - detectionTimestamp) / 60;
                
                return {
                  timestamp: price.timestamp,
                  price: price.priceUsd,
                  marketCap: marketCap,
                  minutesFromDetection: minutesFromDetection
                };
              });
              
              // Check if any intermediate point has a higher market cap
              for (const point of intermediateMarketCaps) {
                if (point.marketCap > highestMarketCap) {
                  highestMarketCap = point.marketCap;
                  highestMarketCapPoint = point;
                }
              }
            }
          }
        }
      }
      
      // Calculate percentage gain from initial market cap to peak
      const percentageGain = ((highestMarketCapPoint.marketCap - initialMarketCap) / initialMarketCap) * 100;
      
      // Calculate time to peak
      const minutesToPeak = highestMarketCapPoint.minutesFromDetection;
      
      return {
        tokenAddress,
        initialMarketCap,
        peakMarketCap: highestMarketCapPoint.marketCap,
        peakPrice: highestMarketCapPoint.price,
        peakTimestamp: highestMarketCapPoint.timestamp,
        percentageGain,
        minutesToPeak
      };
    } catch (error) {
      logger.error(`Error finding peak market cap for ${tokenAddress}: ${error.message}`);
      return null;
    }
  },
  
  /**
   * Get token prices at multiple timestamps
   * 
   * @param {string} tokenAddress - Token contract address
   * @param {Array<number>} timestamps - Array of Unix timestamps
   * @returns {Promise<Array<Object>>} - Price data for each timestamp
   */
  async getTokenPrices(tokenAddress, timestamps) {
    try {
      // Verify we have an API key
      if (!this.apiKey) {
        logger.error('CODEX_API_KEY not set in environment variables');
        return [];
      }
      
      // CODEX API limits to 25 inputs per request, so we need to batch them
      const batchSize = 25;
      const batches = [];
      
      // Split timestamps into batches of 25
      for (let i = 0; i < timestamps.length; i += batchSize) {
        batches.push(timestamps.slice(i, i + batchSize));
      }
      
      // Process each batch
      const results = [];
      
      for (const batch of batches) {
        const query = `
          {
            getTokenPrices(
              inputs: [
                ${batch.map(timestamp => `{
                  address: "${tokenAddress}"
                  networkId: ${this.solanaNetworkId}
                  timestamp: ${timestamp}
                }`).join('\n')}
              ]
            ) {
              address
              priceUsd
              networkId
              timestamp
              confidence
            }
          }
        `;
        
        logger.debug(`Sending batch of ${batch.length} price queries to CODEX API for token ${tokenAddress}`);
        
        const response = await axios({
          url: this.apiUrl,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-codex-api-key': this.apiKey
          },
          data: {
            query: query
          }
        });
        
        if (response.data.errors) {
          logger.error('CODEX API returned errors:', response.data.errors);
          continue;
        }
        
        if (response.data.data && response.data.data.getTokenPrices) {
          results.push(...response.data.data.getTokenPrices);
        }
        
        // Add a small delay between batch requests to respect rate limits
        if (batches.length > 1) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
      
      return results;
    } catch (error) {
      logger.error(`Error fetching token prices: ${error.message}`);
      return [];
    }
  },
  
  /**
   * Batch process peak market caps for multiple tokens
   * 
   * @param {Array<Object>} tokens - Array of {tokenAddress, detectionTime, initialMarketCap} objects
   * @returns {Promise<Array<Object>>} - Array of peak market cap data
   */
  async batchProcessPeakMarketCaps(tokens) {
    try {
      const results = [];
      
      // Process in smaller batches to avoid overloading the API
      const batchSize = 3;
      
      for (let i = 0; i < tokens.length; i += batchSize) {
        const batch = tokens.slice(i, i + batchSize);
        
        // Process each token in the batch sequentially to avoid rate limits
        for (const token of batch) {
          const peakData = await this.findPeakMarketCap(
            token.tokenAddress,
            token.detectionTime,
            token.initialMarketCap
          );
          
          if (peakData) {
            results.push({
              ...token,
              peakData
            });
            
            logger.info(`Processed peak market cap for ${token.tokenName}: ${peakData.percentageGain.toFixed(1)}% gain after ${peakData.minutesToPeak.toFixed(1)} minutes`);
          }
        }
        
        // Add a delay between batches to respect rate limits
        if (i + batchSize < tokens.length) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      return results;
    } catch (error) {
      logger.error(`Error in batch processing peak market caps: ${error.message}`);
      return [];
    }
  }
};

module.exports = peakPriceService;