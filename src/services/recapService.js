// src/services/recapService.js
const logger = require('../utils/logger');
const { getDatabase } = require('../db/connection');
const TransactionModel = require('../db/models/transaction');
const birdeyeService = require('./birdeyeService');
const config = require('../config/config');

/**
 * Service for historical confluence analysis
 */
const recapService = {
  /**
   * Retrieves the first confluences of each token in the last 48 hours
   * @param {string} groupId - Telegram group ID
   * @param {boolean} includePeakData - Whether to include peak market cap data
   * @returns {Promise<Array>} - List of first confluences per token
   */
  async getFirstConfluencesPerToken(groupId, includePeakData = false) {
    try {
      const db = await getDatabase();
      const collection = db.collection(TransactionModel.collectionName);
      
      // Get buy transactions from the last 48 hours
      const cutoffTime = new Date(Date.now() - (48 * 60 * 60 * 1000));
      
      const transactions = await collection.find({
        groupId: groupId.toString(),
        type: 'buy',  // Only interested in buys
        timestamp: { $gte: cutoffTime }
      }).sort({ timestamp: 1 }).toArray(); // Sort by ascending timestamp
      
      logger.info(`Retrieved ${transactions.length} buy transactions for group ${groupId}`);
      
      // Group transactions by token
      const tokenGroups = {};
      
      for (const tx of transactions) {
        // Use token address as identifier if it exists, otherwise use name
        const tokenId = tx.coinAddress && tx.coinAddress.length > 0 ? 
          tx.coinAddress : tx.coin;
        
        if (!tokenId) continue; // Skip transactions without token identifier
        
        if (!tokenGroups[tokenId]) {
          tokenGroups[tokenId] = {
            tokenId: tokenId,
            tokenName: tx.coin || 'UNKNOWN',
            tokenAddress: tx.coinAddress || '',
            transactions: []
          };
        }
        
        // Add transaction to group
        tokenGroups[tokenId].transactions.push({
          walletName: tx.walletName,
          amount: tx.amount,
          usdValue: tx.usdValue || 0,
          baseAmount: tx.baseAmount || 0,
          baseSymbol: tx.baseSymbol || 'SOL',
          marketCap: tx.marketCap || 0,
          timestamp: tx.timestamp
        });
      }
      
      // Identify first confluences for each token
      const confluences = [];
      
      for (const tokenId in tokenGroups) {
        const group = tokenGroups[tokenId];
        
        // Filter to keep only transactions from unique wallets
        const uniqueWallets = [];
        const walletsSeen = new Set();
        
        for (const tx of group.transactions) {
          if (!walletsSeen.has(tx.walletName)) {
            walletsSeen.add(tx.walletName);
            uniqueWallets.push(tx);
          }
        }
        
        // Sort by timestamp to get chronological order
        uniqueWallets.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        
        // If at least 2 different wallets bought this token
        if (uniqueWallets.length >= 2) {
          // The second wallet's purchase corresponds to confluence detection time
          const firstWallet = uniqueWallets[0];
          const secondWallet = uniqueWallets[1];
          
          confluences.push({
            tokenName: group.tokenName,
            tokenAddress: group.tokenAddress,
            firstWallet: {
              name: firstWallet.walletName,
              timestamp: firstWallet.timestamp,
              baseAmount: firstWallet.baseAmount,
              baseSymbol: firstWallet.baseSymbol,
              marketCap: firstWallet.marketCap
            },
            secondWallet: {
              name: secondWallet.walletName,
              timestamp: secondWallet.timestamp,
              baseAmount: secondWallet.baseAmount,
              baseSymbol: secondWallet.baseSymbol,
              marketCap: secondWallet.marketCap
            },
            // Confluence is detected when the second wallet buys
            detectionTimestamp: secondWallet.timestamp,
            detectionMarketCap: secondWallet.marketCap || 0,
            totalUniqueWallets: uniqueWallets.length,
            // If more than 2 wallets, add information about subsequent wallets
            additionalWallets: uniqueWallets.length > 2 ? 
              uniqueWallets.slice(2).map(w => ({ 
                name: w.walletName, 
                timestamp: w.timestamp,
                marketCap: w.marketCap
              })) : []
          });
        }
      }
      
      // Sort confluences by detection timestamp (most recent first)
      confluences.sort((a, b) => new Date(b.detectionTimestamp) - new Date(a.detectionTimestamp));
      
      logger.info(`${confluences.length} initial confluences found for group ${groupId}`);
      
      // If peak data is requested, fetch it for all confluences with addresses
      if (includePeakData && confluences.length > 0) {
        logger.info('Fetching peak market cap data for confluences...');
        await this.fetchPeakMarketCapData(confluences);
      }
      
      return confluences;
    } catch (error) {
      logger.error(`Error in recapService.getFirstConfluencesPerToken: ${error.message}`);
      return [];
    }
  },
  
  /**
   * Fetch ATH market cap data for a list of confluences using Birdeye API
   * @param {Array} confluences - List of confluence objects
   * @returns {Promise<void>}
   */
  async fetchATHData(confluences) {
    try {
      // Only process tokens that have addresses
      const confluencesWithAddresses = confluences.filter(conf => 
        conf.tokenAddress && conf.tokenAddress.trim().length > 0
      );
      
      if (confluencesWithAddresses.length === 0) {
        logger.warn('No tokens with addresses found for ATH data retrieval');
        return;
      }
      
      logger.info(`Fetching ATH data for ${confluencesWithAddresses.length} tokens...`);
      
      // Prepare tokens data for batch processing
      const tokensData = confluencesWithAddresses.map(conf => ({
        tokenAddress: conf.tokenAddress,
        tokenName: conf.tokenName,
        detectionTime: conf.detectionTimestamp,
        initialMarketCap: conf.detectionMarketCap
      }));
      
      // Use batch processing to find ATH (All-Time High)
      const athResults = await birdeyeService.batchProcessATH(tokensData);
      
      // Map results back to confluences
      for (const result of athResults) {
        const matchingConf = confluencesWithAddresses.find(
          conf => conf.tokenAddress === result.tokenAddress
        );
        
        if (matchingConf) {
          matchingConf.athData = result.athData;
          
          logger.debug(
            `ATH for ${matchingConf.tokenName}: ${result.athData.percentageGain.toFixed(1)}% gain ` +
            `after ${result.athData.minutesToATH.toFixed(1)} minutes`
          );
        }
      }
      
      logger.info(`Finished fetching ATH data for ${athResults.length}/${confluencesWithAddresses.length} tokens`);
    } catch (error) {
      logger.error(`Error fetching ATH data for confluences: ${error.message}`);
    }
  },

  /**
   * Format MarketCap for display
   * @param {number} marketCap - MarketCap value
   * @returns {string} - Formatted MarketCap
   */
  formatMarketCap(marketCap) {
    if (!marketCap || isNaN(marketCap)) return 'Unknown';
    
    if (marketCap >= 1000000000) {
      return `${(marketCap / 1000000000).toFixed(1)}B`;
    } else if (marketCap >= 1000000) {
      return `${(marketCap / 1000000).toFixed(1)}M`;
    } else if (marketCap >= 1000) {
      return `${(marketCap / 1000).toFixed(1)}k`;
    } else {
      return marketCap.toString();
    }
  },
  
  /**
   * Format ATH (All-Time High) data
   * @param {Object} athData - ATH data
   * @returns {string} - Formatted string with ATH information
   */
  formatATH(athData) {
    if (!athData) {
      return '';
    }
    
    let result = '\n   ATH:';
    
    // Add ATH gain percentage
    if (athData.percentageGain !== null && athData.percentageGain !== undefined) {
      const emoji = this.getPriceChangeEmoji(athData.percentageGain);
      result += ` ${emoji}${athData.percentageGain.toFixed(1)}%`;
    }
    
    // Add time to ATH
    if (athData.minutesToATH !== null && athData.minutesToATH !== undefined) {
      // Format time to ATH
      let timeToText;
      if (athData.minutesToATH < 60) {
        // If less than 60 minutes, show in minutes
        timeToText = `${Math.round(athData.minutesToATH)}m`;
      } else {
        // If more than 60 minutes, show in hours and minutes
        const hours = Math.floor(athData.minutesToATH / 60);
        const minutes = Math.round(athData.minutesToATH % 60);
        timeToText = minutes > 0 ? `${hours}h${minutes}m` : `${hours}h`;
      }
      
      result += ` after ${timeToText}`;
    }
    
    // Add ATH market cap value
    if (athData.athMarketCap) {
      const formattedMcap = this.formatMarketCap(athData.athMarketCap);
      result += ` (MCAP: ${formattedMcap})`;
    }
    
    return result;
  },
  
  /**
   * Get emoji based on price change percentage
   * @param {number} changePercent - Price change percentage
   * @returns {string} - Emoji representing the price change
   */
  getPriceChangeEmoji(changePercent) {
    if (changePercent === null || changePercent === undefined) {
      return '⚪️';
    }
    
    if (changePercent >= 500) {
      return '💎'; // Diamond for 500%+ gains (6x)
    } else if (changePercent >= 300) {
      return '🔥'; // Fire for 300%+ gains (4x)
    } else if (changePercent >= 100) {
      return '🚀'; // Rocket for 100%+ gains (2x)
    } else if (changePercent >= 50) {
      return '📈'; // Chart up for 50%+ gains
    } else if (changePercent >= 20) {
      return '↗️'; // Up-right arrow for 20%+ gains
    } else if (changePercent > -10 && changePercent < 20) {
      return '➡️'; // Right arrow for small changes
    } else if (changePercent >= -30) {
      return '↘️'; // Down-right arrow for 10-30% losses
    } else if (changePercent >= -50) {
      return '📉'; // Chart down for 30-50% losses
    } else {
      return '💥'; // Explosion for >50% losses
    }
  },
  
  /**
   * Format Telegram message to display confluences
   * @param {Array} confluences - List of confluences
   * @param {boolean} includePeakData - Whether to include peak market cap data
   * @returns {string} - Formatted message for Telegram
   */
  formatRecapMessage(confluences, includePeakData = false) {
    if (confluences.length === 0) {
      return "No confluences detected in the last 48 hours.";
    }
    
    let message = "📊 *CONFLUENCE RECAP (LAST 48H)*\n\n";
    
    // Limit to 15 confluences when including peak data to avoid messages that are too long
    // Otherwise limit to 20
    const limit = includePeakData ? 15 : 20;
    const displayConfluences = confluences.slice(0, limit);
    
    for (const conf of displayConfluences) {
      // Format detection timestamp
      const detectionDate = new Date(conf.detectionTimestamp);
      const formattedDate = detectionDate.toLocaleString('en-US', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      
      // Format MarketCap
      const mcap = this.formatMarketCap(conf.detectionMarketCap);
      
      // Truncate token name if too long
      const tokenName = conf.tokenName.length > 15 ? 
        conf.tokenName.substring(0, 12) + '...' : 
        conf.tokenName;
      
      message += `🔹 *${tokenName}*\n`;
      message += `   Wallets: ${conf.firstWallet.name} ➡️ ${conf.secondWallet.name}`;
      
      // Add counter if more than 2 wallets
      if (conf.totalUniqueWallets > 2) {
        message += ` (+${conf.totalUniqueWallets - 2} more)`;
      }
      
      message += `\n   Detected: ${formattedDate} | MCAP: $${mcap}`;
      
      // Add peak market cap data if available
      if (includePeakData && conf.peakMarketCapData) {
        message += this.formatPeakMarketCap(conf.peakMarketCapData);
      }
      
      message += "\n\n";
    }
    
    // Add note if there are more confluences than displayed
    if (confluences.length > limit) {
      message += `\n_+ ${confluences.length - limit} more confluences..._`;
    }
    
    return message;
  }
};

module.exports = recapService;