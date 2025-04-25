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
  async getPriceHistory(tokenAddress, timeFrom, timeTo, options = {}) {
    try {
      if (!this.apiKey) {
        logger.error('BIRDEYE_API_KEY not set in environment variables');
        return null;
      }
      
      if (!tokenAddress) {
        logger.warn('No token address provided for price history');
        return null;
      }
      
      // Vérifier si l'adresse du token est valide pour Birdeye
      if (!this.isValidTokenAddress(tokenAddress)) {
        logger.warn(`Skipping invalid token address: ${tokenAddress}`);
        return null;
      }

      const url = `${this.baseUrl}/defi/history_price`;
      
      // Calculate time range duration in hours
      const durationHours = (timeTo - timeFrom) / 3600;
      
      // Get optimal resolution based on specific options or time range
      let resolution = '5m'; // Default to 5m
      
      if (options.preferredResolution) {
        // Use caller-specified resolution if provided
        resolution = options.preferredResolution;
      } else {
        // The confluence detection timestamp
        const confluenceTimestamp = options.confluenceTimestamp || timeFrom;
        
        // Calculate time difference from confluence in hours
        const hoursFromConfluence = (timeFrom - confluenceTimestamp) / 3600;
        
        // First 2 hours: use 5m resolution
        if (hoursFromConfluence < 2) {
          resolution = '5m';
        }
        // 2-24 hours: use 15m resolution  
        else if (hoursFromConfluence < 24) {
          resolution = '15m';
        }
        // 24-48 hours: use 30m resolution
        else {
          resolution = '30m';
        }
      }
      
      logger.debug(`Using ${resolution} resolution for token ${tokenAddress} (${durationHours.toFixed(1)}h timeframe)`);
      
      // If the range is greater than 7 days, split into smaller chunks
      if (durationHours > 168) { // 7 days
        logger.debug(`Time range too long (${durationHours}h), splitting into smaller requests`);
        
        // Split into 7-day chunks (or less for the final chunk)
        const chunkSizeSeconds = 7 * 24 * 3600; // 7 days in seconds
        const chunks = [];
        
        for (let chunkStart = timeFrom; chunkStart < timeTo; chunkStart += chunkSizeSeconds) {
          const chunkEnd = Math.min(chunkStart + chunkSizeSeconds, timeTo);
          chunks.push({ start: chunkStart, end: chunkEnd });
        }
        
        // Process each chunk with proper rate limiting
        let allItems = [];
        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i];
          logger.debug(`Fetching chunk ${i+1}/${chunks.length}: ${chunk.start} to ${chunk.end}`);
          
          const params = {
            address: tokenAddress,
            address_type: 'token',
            type: resolution,
            time_from: chunk.start,
            time_to: chunk.end
          };
          
          try {
            const response = await axios.get(url, {
              params,
              headers: {
                'x-api-key': this.apiKey,
                'x-chain': 'solana'
              }
            });
            
            if (response.data?.success && response.data?.data?.items) {
              allItems = allItems.concat(response.data.data.items);
            }
          } catch (error) {
            // Gérer les erreurs d'API spécifiques
            if (error.response && error.response.status === 400) {
              logger.warn(`API Birdeye a rejeté la requête pour le token ${tokenAddress} (400 Bad Request): ${error.response.data?.error || 'Raison inconnue'}`);
              return null;
            } else {
              logger.error(`Erreur API Birdeye pour ${tokenAddress}: ${error.message}`);
              // Continuer avec les autres chunks si possible
            }
          }
          
          // Add rate limiting delay between chunks
          if (i < chunks.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 200)); // 200ms delay (5 rps)
          }
        }
        
        // Return concatenated results from all chunks
        if (allItems.length > 0) {
          return allItems;
        }
        
        logger.warn(`No valid price data returned for token ${tokenAddress}`);
        return null;
      }
      
      // For shorter time ranges, proceed with a single request
      const params = {
        address: tokenAddress,
        address_type: 'token',
        type: resolution,
        time_from: timeFrom,
        time_to: timeTo
      };
      
      logger.debug(`Fetching price history for token ${tokenAddress} from ${timeFrom} to ${timeTo} with resolution ${resolution}`);
      
      try {
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
        // Gérer les erreurs d'API spécifiques
        if (error.response && error.response.status === 400) {
          logger.warn(`API Birdeye a rejeté la requête pour le token ${tokenAddress} (400 Bad Request): ${error.response.data?.error || 'Raison inconnue'}`);
          return null;
        }
        logger.error(`Error fetching price history from Birdeye: ${error.message}`);
        return null;
      }
    } catch (error) {
      logger.error(`Error in getPriceHistory: ${error.message}`);
      return null;
    }
  },
  
  /**
   * Find ATH (All-Time High) for a token after a specific timestamp
   * 
   * @param {string} tokenAddress - Token contract address
   * @param {Date|number} fromTimestamp - Start timestamp as Date or in milliseconds
   * @param {Date|number} toTimestamp - End timestamp (optional, defaults to now)
   * @returns {Promise<Object|null>} - ATH data or null if not found
   */
  /**
   * Find ATH (All-Time High) for a token after a specific timestamp, stopping at -50% drop if detected
   * 
   * @param {string} tokenAddress - Token contract address
   * @param {Date|number} fromTimestamp - Start timestamp as Date or in milliseconds
   * @param {Date|number} toTimestamp - End timestamp (optional, defaults to now)
   * @returns {Promise<Object|null>} - ATH data or null if not found
   */
  async findATH(tokenAddress, fromTimestamp, toTimestamp = Date.now(), options = {}) {
    try {
      // Convert Date objects to timestamps if needed
      const fromTs = fromTimestamp instanceof Date ? fromTimestamp.getTime() : fromTimestamp;
      const toTs = toTimestamp instanceof Date ? toTimestamp.getTime() : toTimestamp;
      
      // Convert timestamps from milliseconds to seconds for Birdeye API
      const timeFrom = Math.floor(fromTs / 1000);
      const confluenceTimestamp = timeFrom; // Store original detection time
      
      // Check if we are using high precision mode
      const useHighPrecision = options.highPrecision || false;
      
      // Default time windows
      let firstPhaseMinutes = 30;  // Default first phase is 30 minutes
      let secondPhaseMinutes = 90; // Default second phase is 90 minutes (30m-2h)
      
      // Default resolutions
      let firstPhaseResolution = '5m';  // Default resolution for first phase
      let secondPhaseResolution = '15m'; // Default resolution for second phase
      let thirdPhaseResolution = '30m';  // Default resolution for third phase
      
      // Override defaults if options are provided
      if (useHighPrecision) {
        logger.debug(`Using high precision analysis for token ${tokenAddress}`);
        
        // Override first phase duration if specified
        if (options.initialMinutes && options.initialMinutes > 0) {
          firstPhaseMinutes = options.initialMinutes;
        }
        
        // Override resolutions if specified
        if (options.initialResolution) {
          firstPhaseResolution = options.initialResolution;
        }
        if (options.midResolution) {
          secondPhaseResolution = options.midResolution;
        }
        if (options.lateResolution) {
          thirdPhaseResolution = options.lateResolution;
        }
        
        logger.debug(`Analysis phases: ${firstPhaseMinutes}m with ${firstPhaseResolution}, then with ${secondPhaseResolution}, then with ${thirdPhaseResolution}`);
      }
      
      // Calculate phase end times
      const firstPhaseEnd = timeFrom + (firstPhaseMinutes * 60); // e.g., first 30 minutes
      const secondPhaseEnd = timeFrom + ((firstPhaseMinutes + secondPhaseMinutes) * 60); // e.g., 30m to 2h
      
      // Implement progressive approach - first analyze with high precision
      const firstPhaseEndTime = Math.min(Math.floor(toTs / 1000), firstPhaseEnd);
      
      // Get first phase price history with high precision (e.g., 1m resolution)
      logger.debug(`Fetching first phase (${firstPhaseResolution}) price history for ${tokenAddress}`);
      const firstPhaseHistory = await this.getPriceHistory(
        tokenAddress, 
        timeFrom, 
        firstPhaseEndTime, 
        {
          preferredResolution: firstPhaseResolution,
          confluenceTimestamp: confluenceTimestamp
        }
      );
      
      // Initialize all price history with first phase data
      let allPriceHistory = firstPhaseHistory || [];
      
      if (!allPriceHistory || allPriceHistory.length === 0) {
        logger.warn(`No price history found for token ${tokenAddress} in first phase`);
        return null;
      }
      
      // Initial price is our baseline for calculating the 50% drop
      const initialPrice = allPriceHistory[0]?.value || 0;
      if (initialPrice <= 0) {
        logger.warn(`Invalid initial price (${initialPrice}) for token ${tokenAddress}`);
        return null;
      }
      
      // Find the maximum price and check for 50% drop in first phase
      let maxPrice = initialPrice;
      let maxPriceTimestamp = timeFrom;
      let maxPriceIndex = 0;
      
      // Initialize minimum price tracking (NEW)
      let minPrice = initialPrice;
      let minPriceTimestamp = timeFrom;
      let minPriceIndex = 0;
      let minPriceBeforeAth = initialPrice; // Track minimum price before ATH
      let minPriceBeforeAthTimestamp = timeFrom;
      
      let drop50PctDetected = false;
      let drop50PctTimestamp = 0;
      let currentEndTime = firstPhaseEndTime;
      
      // Process first batch of price data (first phase)
      for (let i = 0; i < allPriceHistory.length; i++) {
        const point = allPriceHistory[i];
        
        // Update min price tracking (NEW)
        if (point.value < minPrice) {
          minPrice = point.value;
          minPriceTimestamp = point.unixTime;
          minPriceIndex = i;
        }
        
        // Update min price before ATH (NEW) - only if we haven't found a new ATH yet
        if (point.value < minPriceBeforeAth && point.unixTime <= maxPriceTimestamp) {
          minPriceBeforeAth = point.value;
          minPriceBeforeAthTimestamp = point.unixTime;
        }
        
        // Update max price if found
        if (point.value > maxPrice) {
          maxPrice = point.value;
          maxPriceTimestamp = point.unixTime;
          maxPriceIndex = i;
          
          // Reset minPriceBeforeAth tracking with new ATH (NEW)
          minPriceBeforeAth = initialPrice;
          minPriceBeforeAthTimestamp = timeFrom;
          
          // Re-scan all previous points to find the minimum before this new ATH (NEW)
          for (let j = 0; j < i; j++) {
            if (allPriceHistory[j].value < minPriceBeforeAth) {
              minPriceBeforeAth = allPriceHistory[j].value;
              minPriceBeforeAthTimestamp = allPriceHistory[j].unixTime;
            }
          }
        }
        
        // Check for 50% drop from INITIAL price (not from ATH)
        if (point.value <= initialPrice * 0.5) {
          logger.debug(`-50% from initial price detected for ${tokenAddress} at ${point.unixTime}`);
          drop50PctDetected = true;
          drop50PctTimestamp = point.unixTime;
          currentEndTime = point.unixTime;
          break; // Stop checking further price points
        }
      }
      
      // If no 50% drop and we haven't reached the requested end time, fetch more data
      if (!drop50PctDetected && firstPhaseEndTime < Math.floor(toTs / 1000)) {
        // We've checked first phase, now fetch second phase period with medium resolution
        const secondPhaseEndTime = Math.min(Math.floor(toTs / 1000), secondPhaseEnd);
        
        if (firstPhaseEndTime < secondPhaseEndTime) {
          logger.debug(`Fetching second phase (${secondPhaseResolution}) period for ${tokenAddress}`);
          const secondPhaseHistory = await this.getPriceHistory(
            tokenAddress, 
            firstPhaseEndTime, 
            secondPhaseEndTime, 
            {
              preferredResolution: secondPhaseResolution,
              confluenceTimestamp: confluenceTimestamp
            }
          );
          
          if (secondPhaseHistory && secondPhaseHistory.length > 0) {
            allPriceHistory = allPriceHistory.concat(secondPhaseHistory);
            currentEndTime = secondPhaseEndTime;
            
            // Process this batch of data
            for (let i = 0; i < secondPhaseHistory.length; i++) {
              const point = secondPhaseHistory[i];
              const allHistoryIndex = allPriceHistory.indexOf(point);
              
              // Update min price tracking (NEW)
              if (point.value < minPrice) {
                minPrice = point.value;
                minPriceTimestamp = point.unixTime;
                minPriceIndex = allHistoryIndex;
              }
              
              // Update min price before ATH (NEW) - only if this point is before current ATH
              if (point.value < minPriceBeforeAth && point.unixTime <= maxPriceTimestamp) {
                minPriceBeforeAth = point.value;
                minPriceBeforeAthTimestamp = point.unixTime;
              }
              
              // Update max price if found
              if (point.value > maxPrice) {
                maxPrice = point.value;
                maxPriceTimestamp = point.unixTime;
                maxPriceIndex = allHistoryIndex;
                
                // Reset minPriceBeforeAth tracking with new ATH (NEW)
                minPriceBeforeAth = initialPrice;
                minPriceBeforeAthTimestamp = timeFrom;
                
                // Re-scan all previous points to find the minimum before this new ATH (NEW)
                for (let j = 0; j < allHistoryIndex; j++) {
                  if (allPriceHistory[j].value < minPriceBeforeAth) {
                    minPriceBeforeAth = allPriceHistory[j].value;
                    minPriceBeforeAthTimestamp = allPriceHistory[j].unixTime;
                  }
                }
              }
              
              // Check for 50% drop from initial price
              if (point.value <= initialPrice * 0.5) {
                logger.debug(`-50% from initial price detected in second phase for ${tokenAddress}`);
                drop50PctDetected = true;
                drop50PctTimestamp = point.unixTime;
                currentEndTime = point.unixTime;
                break; // Stop checking further price points
              }
            }
          }
        }
        
        // If still no 50% drop and we need to check third phase
        if (!drop50PctDetected && secondPhaseEndTime < Math.floor(toTs / 1000)) {
          const finalEndTime = Math.min(Math.floor(toTs / 1000), timeFrom + (48 * 60 * 60)); // Max 48h
          
          if (secondPhaseEndTime < finalEndTime) {
            logger.debug(`Fetching third phase (${thirdPhaseResolution}) period for ${tokenAddress}`);
            const thirdPhaseHistory = await this.getPriceHistory(
              tokenAddress, 
              secondPhaseEndTime, 
              finalEndTime, 
              {
                preferredResolution: thirdPhaseResolution,
                confluenceTimestamp: confluenceTimestamp
              }
            );
            
            if (thirdPhaseHistory && thirdPhaseHistory.length > 0) {
              allPriceHistory = allPriceHistory.concat(thirdPhaseHistory);
              currentEndTime = finalEndTime;
              
              // Process this batch of data
              for (let i = 0; i < thirdPhaseHistory.length; i++) {
                const point = thirdPhaseHistory[i];
                const allHistoryIndex = allPriceHistory.indexOf(point);
                
                // Update min price tracking (NEW)
                if (point.value < minPrice) {
                  minPrice = point.value;
                  minPriceTimestamp = point.unixTime;
                  minPriceIndex = allHistoryIndex;
                }
                
                // Update min price before ATH (NEW) - only if this point is before current ATH
                if (point.value < minPriceBeforeAth && point.unixTime <= maxPriceTimestamp) {
                  minPriceBeforeAth = point.value;
                  minPriceBeforeAthTimestamp = point.unixTime;
                }
                
                // Update max price if found
                if (point.value > maxPrice) {
                  maxPrice = point.value;
                  maxPriceTimestamp = point.unixTime;
                  maxPriceIndex = allHistoryIndex;
                  
                  // Reset minPriceBeforeAth tracking with new ATH (NEW)
                  minPriceBeforeAth = initialPrice;
                  minPriceBeforeAthTimestamp = timeFrom;
                  
                  // Re-scan all previous points to find the minimum before this new ATH (NEW)
                  for (let j = 0; j < allHistoryIndex; j++) {
                    if (allPriceHistory[j].value < minPriceBeforeAth) {
                      minPriceBeforeAth = allPriceHistory[j].value;
                      minPriceBeforeAthTimestamp = allPriceHistory[j].unixTime;
                    }
                  }
                }
                
                // Check for 50% drop from initial price
                if (point.value <= initialPrice * 0.5) {
                  logger.debug(`-50% from initial price detected in third phase for ${tokenAddress}`);
                  drop50PctDetected = true;
                  drop50PctTimestamp = point.unixTime;
                  currentEndTime = point.unixTime;
                  break; // Stop checking further price points
                }
              }
            }
          }
        }
      }
      
      // Now compute final stats based on all collected data
      logger.debug(`Analyzed ${allPriceHistory.length} price points for ${tokenAddress} from ${timeFrom} to ${currentEndTime}`);
      
      // Calculate time from detection to ATH
      const timeToATHSeconds = maxPriceTimestamp - timeFrom;
      const timeToATHMinutes = timeToATHSeconds / 60;
      
      // Calculate percentage gain from initial price to ATH
      const percentageGain = initialPrice > 0
        ? ((maxPrice - initialPrice) / initialPrice) * 100
        : 0;
        
      // Calculate minimum price drop before ATH (NEW)
      const minBeforeAthPercentage = initialPrice > 0
        ? ((minPriceBeforeAth - initialPrice) / initialPrice) * 100
        : 0;
      
      const timeToMinBeforeAthSeconds = minPriceBeforeAthTimestamp - timeFrom;
      const timeToMinBeforeAthMinutes = timeToMinBeforeAthSeconds / 60;
      
      // Information about price drop
      let dropPercentage = 0;
      let timeToDrop = 0;
      let lowestPriceAfterATH = maxPrice;
      
      // If 50% drop from initial was detected
      if (drop50PctDetected) {
        dropPercentage = 50;
        timeToDrop = (drop50PctTimestamp - timeFrom) / 60; // Minutes from detection to 50% drop
      } 
      // Otherwise, find the lowest point after ATH
      else if (maxPriceIndex < allPriceHistory.length - 1) {
        // Find minimum price after ATH
        for (let i = maxPriceIndex + 1; i < allPriceHistory.length; i++) {
          const price = allPriceHistory[i].value;
          if (price < lowestPriceAfterATH) {
            lowestPriceAfterATH = price;
          }
        }
        
        // Calculate drop percentage from ATH
        dropPercentage = maxPrice > 0 
          ? ((maxPrice - lowestPriceAfterATH) / maxPrice) * 100 
          : 0;
          
        // Calculate time from detection to lowest point
        const lowestPointTimestamp = allPriceHistory.find(p => p.value === lowestPriceAfterATH)?.unixTime || currentEndTime;
        timeToDrop = (lowestPointTimestamp - timeFrom) / 60; // Minutes
      }
      
      // Early drop information (specific drop percentages like 20%, 30%, 40%)
      const earlyDrops = [];
      const dropThresholds = [20, 30, 40, 50]; // Percentage drops to check for
      
      for (const threshold of dropThresholds) {
        const dropThreshold = initialPrice * (1 - threshold/100);
        
        // Find first point where price drops below threshold
        for (let i = 0; i < allPriceHistory.length; i++) {
          if (allPriceHistory[i].value <= dropThreshold) {
            const dropTime = (allPriceHistory[i].unixTime - timeFrom) / 60; // Minutes
            earlyDrops.push({
              percentage: threshold,
              minutesFromDetection: dropTime,
              timestamp: allPriceHistory[i].unixTime * 1000, // Convert to milliseconds
              formattedTime: this.formatTimeToATH(dropTime)
            });
            break;
          }
        }
      }
      
      return {
        tokenAddress,
        initialPrice,
        athPrice: maxPrice,
        athTimestamp: maxPriceTimestamp * 1000, // Convert to milliseconds
        percentageGain,
        minutesToATH: timeToATHMinutes,
        
        // New minimum price before ATH data
        minPriceBeforeAth: minPriceBeforeAth,
        minBeforeAthPercentage,
        minutesToMinBeforeAth: timeToMinBeforeAthMinutes,
        minBeforeAthTimestamp: minPriceBeforeAthTimestamp * 1000, // Convert to milliseconds
        
        // Other existing fields
        dropPercentage,
        timeToDrop,
        dataPoints: allPriceHistory.length,
        timeToATHFormatted: this.formatTimeToATH(timeToATHMinutes),
        timeToMinBeforeAthFormatted: this.formatTimeToATH(timeToMinBeforeAthMinutes), // NEW
        earlyDrops: earlyDrops,
        drop50PctDetected,
        drop50PctTimestamp: drop50PctDetected ? drop50PctTimestamp * 1000 : null
      };
    } catch (error) {
      logger.error(`Error finding ATH for ${tokenAddress}: ${error.message}`);
      return null;
    }
  },

  /**
   * Vérifie si une adresse de token est probablement valide pour l'API Birdeye
   * @param {string} tokenAddress - Adresse du token à vérifier
   * @returns {boolean} - True si l'adresse semble valide
   */
    isValidTokenAddress(tokenAddress) {
        if (!tokenAddress) return false;
        
        // Les addresses Solana valides sont généralement des Base58, ~44 caractères
        // Les addresses simulées commencent généralement par "SIM" dans notre système
        if (tokenAddress.startsWith('SIM')) {
        logger.debug(`Adresse simulée détectée (${tokenAddress}), considérée comme invalide pour Birdeye`);
        return false;
        }
        
        // Vérification basique de longueur pour Solana
        if (tokenAddress.length < 30) {
        logger.debug(`Adresse trop courte (${tokenAddress}), considérée comme invalide pour Birdeye`);
        return false;
        }
        
        return true;
    },
  
  /**
   * Format time to ATH for display
   * @param {number} minutes - Time to ATH in minutes
   * @returns {string} - Formatted time
   */
  formatTimeToATH(minutes) {
    if (minutes < 60) {
      return `${Math.round(minutes)}m`;
    } else if (minutes < 1440) { // Less than 24 hours
      const hours = Math.floor(minutes / 60);
      const mins = Math.round(minutes % 60);
      return mins > 0 ? `${hours}h${mins}m` : `${hours}h`;
    } else {
      const days = Math.floor(minutes / 1440);
      const hours = Math.floor((minutes % 1440) / 60);
      return hours > 0 ? `${days}d${hours}h` : `${days}d`;
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
   * Calculate price from market cap
   * 
   * @param {number} marketCap - Market cap in USD
   * @param {number} supply - Token supply (default: 1,000,000,000)
   * @returns {number} - Token price in USD
   */
  calculatePrice(marketCap, supply = 1000000000) {
    return marketCap / supply;
  },
  
  /**
   * Batch process ATH data for multiple tokens
   * 
   * @param {Array<Object>} tokens - Array of {tokenAddress, tokenName, detectionTime, initialMarketCap} objects
   * @returns {Promise<Array<Object>>} - Array of ATH data
   */
  async batchProcessATH(tokens) {
    try {
      const results = [];
      
      // Filtrer pour ignorer les adresses de token simulées ou invalides
      const validTokens = tokens.filter(token => this.isValidTokenAddress(token.tokenAddress));
      
      if (validTokens.length === 0) {
        logger.warn('Aucune adresse de token valide trouvée pour l\'analyse Birdeye');
        return [];
      }
      
      logger.info(`Validation des adresses: ${validTokens.length} valides sur ${tokens.length} tokens`);
      
      // Throttle to respect API limits (15 rps for Starter plan)
      // Using a conservative 5 rps to account for other potential API calls
      const rateLimit = 5; // Requests per second
      const delayBetweenRequests = Math.ceil(1000 / rateLimit);
      
      // Process in smaller batches to avoid memory issues
      const batchSize = 3;
      
      logger.info(`Processing ATH data for ${validTokens.length} tokens with rate limit of ${rateLimit} rps...`);
      
      // Process tokens sequentially to maintain rate limits
      for (let i = 0; i < validTokens.length; i += batchSize) {
        // Extract current batch
        const batch = validTokens.slice(i, Math.min(i + batchSize, validTokens.length));
        
        logger.debug(`Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(validTokens.length/batchSize)}`);
        
        // Process tokens in this batch sequentially (not in parallel)
        for (let j = 0; j < batch.length; j++) {
          const token = batch[j];
          
          try {
            logger.debug(`Processing token ${token.tokenName} (${j+1}/${batch.length})`);
            
            // Calculate initial price from market cap
            const initialPrice = this.calculatePrice(token.initialMarketCap);
            
            // Determine appropriate time window based on token age
            // Default to looking 24h ahead from confluence detection
            const detectionDate = token.detectionTime instanceof Date
              ? token.detectionTime
              : new Date(token.detectionTime);
              
            const now = new Date();
            const timeSinceDetection = (now - detectionDate) / (1000 * 60 * 60); // Hours
            
            // Cap the search window to avoid excessive API calls
            // For recent tokens: look from detection to now
            // For older tokens: look 48h from detection
            const searchEndDate = timeSinceDetection < 48
              ? now
              : new Date(detectionDate.getTime() + (48 * 60 * 60 * 1000));
            
            // Find ATH
            const athData = await this.findATH(
              token.tokenAddress,
              detectionDate,
              searchEndDate
            );
            
            // Apply rate limiting between API calls
            await new Promise(resolve => setTimeout(resolve, delayBetweenRequests));
            
            if (athData) {
              // Calculate market caps
              const athMarketCap = this.calculateMarketCap(athData.athPrice);
              
              // If we have the initial market cap but not the initial price from API,
              // calculate percentage gain directly from market caps
              const percentageGain = initialPrice > 0 && athData.initialPrice > 0
                ? athData.percentageGain  // Use API-calculated gain if available
                : token.initialMarketCap > 0 && athMarketCap > 0
                  ? ((athMarketCap - token.initialMarketCap) / token.initialMarketCap) * 100
                  : athData.percentageGain;  // Fallback to API calculation
              
              results.push({
                tokenAddress: token.tokenAddress,
                tokenName: token.tokenName,
                detectionTime: token.detectionTime,
                initialMarketCap: token.initialMarketCap,
                athData: {
                  ...athData,
                  initialPrice,
                  percentageGain,
                  athMarketCap
                }
              });
              
              logger.info(`Token ${token.tokenName}: ${percentageGain.toFixed(1)}% gain after ${athData.minutesToATH.toFixed(1)} minutes`);
            } else {
              logger.warn(`No ATH data found for token ${token.tokenName}`);
            }
          } catch (err) {
            logger.error(`Error processing token ${token.tokenName}: ${err.message}`);
          }
        }
        
        // Add additional delay between batches
        if (i + batchSize < validTokens.length) {
          logger.debug(`Batch complete, waiting before processing next batch...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
      
      // Log summary of results
      logger.info(`Successfully processed ATH data for ${results.length}/${validTokens.length} tokens`);
      
      return results;
    } catch (error) {
      logger.error(`Error in batch processing ATH: ${error.message}`);
      return [];
    }
  }
};

module.exports = birdeyeService;