// src/services/recapService.js
const logger = require('../utils/logger');
const { getDatabase } = require('../db/connection');
const TransactionModel = require('../db/models/transaction');
const birdeyeService = require('./birdeyeService');
const config = require('../config/config');

/**
 * Service for historical confluence analysis and performance tracking
 */
const recapService = {
  /**
   * Get performance data for confluences within a timeframe
   * @param {string} groupId - Telegram group ID
   * @param {number} timeframeHours - Time window in hours
   * @returns {Promise<Object>} - Performance data
   */
  async getPerformanceData(groupId, timeframeHours = 24) {
    try {
      // Calculate cutoff time for the specified timeframe
      const cutoffTime = new Date(Date.now() - (timeframeHours * 60 * 60 * 1000));
      
      // Get all confluences in the timeframe
      const confluences = await this.getConfluencesInTimeframe(groupId, cutoffTime);
      
      if (confluences.length === 0) {
        return { confluences: [] };
      }
      
      // Get performance data for each confluence
      const performanceData = await this.getConfluencesPerformance(confluences);
      
      // Calculate wallet performance
      const walletPerformance = this.calculateWalletPerformance(performanceData);
      
      // Calculate group statistics
      const groupStats = this.calculateGroupStats(performanceData, timeframeHours);
      
      return {
        confluences: performanceData,
        walletPerformance,
        groupStats
      };
    } catch (error) {
      logger.error(`Error in recapService.getPerformanceData: ${error.message}`);
      return { confluences: [] };
    }
  },

  /**
   * Get confluences that occurred within a specific timeframe
   * @param {string} groupId - Group ID
   * @param {Date} cutoffTime - Cutoff timestamp
   * @returns {Promise<Array>} - List of confluences
   */
  async getConfluencesInTimeframe(groupId, cutoffTime) {
    try {
      const db = await getDatabase();
      const collection = db.collection(TransactionModel.collectionName);
      
      // First get all tokens that had transactions in this period
      const tokens = await collection.aggregate([
        {
          $match: {
            groupId: groupId.toString(),
            timestamp: { $gte: cutoffTime }
          }
        },
        {
          $group: {
            _id: { 
              coinAddress: "$coinAddress", 
              coin: "$coin" 
            },
            wallets: { $addToSet: "$walletName" },
            transactions: { $push: "$$ROOT" },
            firstTimestamp: { $min: "$timestamp" },
            lastTimestamp: { $max: "$timestamp" },
            marketCap: { $avg: "$marketCap" }
          }
        },
        {
          $match: {
            "wallets.0": { $exists: true },
            "wallets.1": { $exists: true }  // At least 2 different wallets
          }
        },
        {
          $sort: { lastTimestamp: -1 }  // Most recent first
        },
        {
          $limit: 50  // Reasonable limit to avoid processing too many
        }
      ]).toArray();
      
      // Format for easier processing
      const confluences = tokens.map(token => {
        // Identify the first 2 wallet transactions to determine detection time
        let detectionTimestamp;
        if (token.transactions.length >= 2) {
          // Sort by timestamp
          const sortedTx = [...token.transactions].sort((a, b) => 
            new Date(a.timestamp) - new Date(b.timestamp)
          );
          
          // Unique wallets in order of appearance
          const uniqueWallets = [];
          const walletsSeen = new Set();
          
          for (const tx of sortedTx) {
            if (!walletsSeen.has(tx.walletName)) {
              walletsSeen.add(tx.walletName);
              uniqueWallets.push(tx);
              
              // When we have 2 unique wallets, we have a confluence
              if (uniqueWallets.length === 2) {
                detectionTimestamp = tx.timestamp;
                break;
              }
            }
          }
        } else {
          detectionTimestamp = token.firstTimestamp;
        }
        
        return {
          tokenName: token._id.coin,
          tokenAddress: token._id.coinAddress,
          detectionTimestamp: detectionTimestamp,
          detectionMarketCap: token.marketCap,
          totalUniqueWallets: token.wallets.length,
          wallets: token.wallets
        };
      });
      
      return confluences;
    } catch (error) {
      logger.error(`Error in recapService.getConfluencesInTimeframe: ${error.message}`);
      return [];
    }
  },

  /**
   * Get performance data for a list of confluences
   * @param {Array} confluences - List of confluences
   * @returns {Promise<Array>} - Confluences with performance data
   */
  async getConfluencesPerformance(confluences) {
    try {
      if (confluences.length === 0) return [];
      
      // Filter to only tokens with addresses
      const confluencesWithAddresses = confluences.filter(conf => 
        conf.tokenAddress && conf.tokenAddress.trim().length > 0
      );
      
      if (confluencesWithAddresses.length === 0) {
        logger.warn('No confluences with token addresses found for performance analysis');
        return confluences;
      }
      
      // Prepare tokens data for batch processing
      const tokensData = confluencesWithAddresses.map(conf => ({
        tokenAddress: conf.tokenAddress,
        tokenName: conf.tokenName,
        detectionTime: new Date(conf.detectionTimestamp),
        initialMarketCap: conf.detectionMarketCap
      }));
      
      // Use batch processing to find ATH (All-Time High)
      const athResults = await birdeyeService.batchProcessATH(tokensData);
      
      // Map results back to confluences
      const enhancedConfluences = [...confluences];
      
      for (const result of athResults) {
        const matchingConfIndex = enhancedConfluences.findIndex(
          conf => conf.tokenAddress === result.tokenAddress
        );
        
        if (matchingConfIndex >= 0) {
          enhancedConfluences[matchingConfIndex].performance = {
            percentageGain: result.athData.percentageGain,
            minutesToATH: result.athData.minutesToATH,
            timeToATHFormatted: result.athData.timeToATHFormatted,
            athMarketCap: result.athData.athMarketCap,
            
            // For quick dumps
            drop50PctDetected: result.athData.drop50PctDetected,
            earlyDrops: result.athData.earlyDrops
          };
        }
      }
      
      return enhancedConfluences;
    } catch (error) {
      logger.error(`Error getting performance data: ${error.message}`);
      return confluences;
    }
  },

  /**
   * Calculate performance metrics for each wallet
   * @param {Array} confluences - List of confluences with performance data
   * @returns {Array} - Wallet performance data
   */
  calculateWalletPerformance(confluences) {
    try {
      const walletStats = {};
      
      // Process each confluence
      for (const conf of confluences) {
        // Skip if no performance data
        if (!conf.performance) continue;
        
        const gain = conf.performance.percentageGain;
        const isProfit = gain > 0;
        const isProfitable = gain >= 100; // 100%+ is considered a hit
        
        // Update stats for each wallet involved
        for (const wallet of conf.wallets) {
          if (!walletStats[wallet]) {
            walletStats[wallet] = {
              totalConfluences: 0,
              profitConfluences: 0,
              hitConfluences: 0, // 100%+ gain
              totalGain: 0,
              avgGain: 0,
              successRate: 0
            };
          }
          
          // Update wallet stats
          walletStats[wallet].totalConfluences++;
          
          if (isProfit) {
            walletStats[wallet].profitConfluences++;
          }
          
          if (isProfitable) {
            walletStats[wallet].hitConfluences++;
          }
          
          walletStats[wallet].totalGain += gain;
          walletStats[wallet].avgGain = walletStats[wallet].totalGain / walletStats[wallet].totalConfluences;
          walletStats[wallet].successRate = walletStats[wallet].profitConfluences / walletStats[wallet].totalConfluences;
        }
      }
      
      // Convert to array and sort by profitability
      return Object.entries(walletStats)
        .map(([wallet, stats]) => ({
          walletName: wallet,
          ...stats,
          score: (stats.hitConfluences * 2) + stats.profitConfluences + (stats.avgGain / 100)
        }))
        .sort((a, b) => b.score - a.score);
    } catch (error) {
      logger.error(`Error calculating wallet performance: ${error.message}`);
      return [];
    }
  },

  /**
   * Calculate group statistics
   * @param {Array} confluences - List of confluences with performance data
   * @param {number} timeframeHours - Timeframe in hours
   * @returns {Object} - Group statistics
   */
  calculateGroupStats(confluences, timeframeHours) {
    try {
      // Filter to only confluences with performance data
      const confWithPerf = confluences.filter(conf => conf.performance);
      
      if (confWithPerf.length === 0) {
        return {
          totalConfluences: confluences.length,
          analyzedConfluences: 0,
          hitRate: 0,
          medianGain: 0,
          avgPnL: 0,
          timeframeHours
        };
      }
      
      // Extract gains and sort for median calculation
      const gains = confWithPerf.map(conf => conf.performance.percentageGain).sort((a, b) => a - b);
      
      // Calculate hit rate (tokens with >100% gain)
      const hitsCount = confWithPerf.filter(conf => conf.performance.percentageGain >= 100).length;
      const hitRate = (hitsCount / confWithPerf.length) * 100;
      
      // Calculate median
      const medianGain = gains.length % 2 === 0
        ? (gains[gains.length / 2 - 1] + gains[gains.length / 2]) / 2
        : gains[Math.floor(gains.length / 2)];
      
      // Calculate average PnL
      const avgPnL = gains.reduce((sum, gain) => sum + gain, 0) / gains.length;
      
      return {
        totalConfluences: confluences.length,
        analyzedConfluences: confWithPerf.length,
        hitRate,
        medianGain,
        avgPnL,
        timeframeHours
      };
    } catch (error) {
      logger.error(`Error calculating group stats: ${error.message}`);
      return {
        totalConfluences: confluences.length,
        analyzedConfluences: 0,
        hitRate: 0,
        medianGain: 0,
        avgPnL: 0,
        timeframeHours
      };
    }
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
  }
};

module.exports = recapService;