// src/services/recapService.js
const logger = require('../utils/logger');
const { getDatabase } = require('../db/connection');
const TransactionModel = require('../db/models/transaction');
const confluenceDbService = require('../db/services/confluenceDbService');
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
      
      logger.info(`Getting performance data for group ${groupId} since ${cutoffTime.toISOString()} (${timeframeHours}h timeframe)`);
      
      // Get confluences from database (instead of calculating from transactions)
      const confluences = await confluenceDbService.getConfluencesInTimeframe(groupId, cutoffTime);
      
      logger.info(`Found ${confluences.length} confluences in the timeframe for group ${groupId}`);
      
      if (confluences.length === 0) {
        return { confluences: [] };
      }
      
      // Format confluences to match the expected structure for performance analysis
      const formattedConfluences = confluences.map(conf => ({
        tokenName: conf.tokenSymbol,
        tokenAddress: conf.tokenAddress,
        detectionTimestamp: conf.timestamp,
        detectionMarketCap: conf.avgMarketCap,
        totalUniqueWallets: conf.count,
        wallets: conf.wallets.map(w => w.walletName),
        transactions: conf.wallets.flatMap(wallet => 
          wallet.transactions ? wallet.transactions : [{
            walletName: wallet.walletName,
            type: wallet.type,
            amount: wallet.amount,
            baseAmount: wallet.baseAmount,
            timestamp: conf.timestamp
          }]
        )
      }));
      
      // Get performance data for each confluence
      const performanceData = await this.getConfluencesPerformance(formattedConfluences);
      
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
   * Fallback method that uses transactions when no confluences in database
   * @param {string} groupId - Group ID
   * @param {Date} cutoffTime - Cutoff timestamp
   * @returns {Promise<Array>} - List of confluences
   */
  async getConfluencesInTimeframe(groupId, cutoffTime) {
    try {
      // First try to get confluences from dedicated collection
      const dbConfluences = await confluenceDbService.getConfluencesInTimeframe(groupId, cutoffTime);
      
      if (dbConfluences && dbConfluences.length > 0) {
        logger.info(`Found ${dbConfluences.length} confluences in database for group ${groupId}`);
        return dbConfluences;
      }
      
      // Fallback to calculating from transactions if no confluences found
      logger.info(`No confluences found in database, calculating from transactions for group ${groupId}`);
      
      const db = await getDatabase();
      const collection = db.collection(TransactionModel.collectionName);
      
      logger.info(`Querying transactions since ${cutoffTime.toISOString()} for group ${groupId}`);
      
      // Check if we have any transactions for this group in this timeframe
      const transactionCount = await collection.countDocuments({
        groupId: groupId.toString(),
        timestamp: { $gte: cutoffTime }
      });
      
      logger.info(`Found ${transactionCount} total transactions in timeframe for group ${groupId}`);
      
      if (transactionCount === 0) {
        return [];
      }
      
      // Group transactions by token to find confluences
      // Prioritize coinAddress over coin name for grouping
      const tokens = await collection.aggregate([
        // Step 1: Match transactions in the specified timeframe for this group
        {
          $match: {
            groupId: groupId.toString(),
            timestamp: { $gte: cutoffTime }
          }
        },
        // Step 2: Sort by timestamp to get proper order
        {
          $sort: { timestamp: 1 }
        },
        // Step 3: Group primarily by token address, with name as a fallback
        {
          $group: {
            _id: { 
              // Use address as primary identifier when available, else use name
              coinAddress: { $cond: [{ $ne: ["$coinAddress", ""] }, "$coinAddress", null] },
              coin: { $cond: [{ $eq: ["$coinAddress", ""] }, "$coin", "$coin"] } // Always include coin name
            },
            wallets: { $addToSet: "$walletName" },
            transactions: { $push: "$$ROOT" },
            firstTimestamp: { $min: "$timestamp" },
            lastTimestamp: { $max: "$timestamp" },
            marketCap: { $avg: "$marketCap" },
            minMarketCap: { $min: "$marketCap" },
            maxMarketCap: { $max: "$marketCap" },
            transactionCount: { $sum: 1 }
          }
        },
        // Step 4: Filter to only tokens with multiple wallets (confluences)
        {
          $match: {
            "wallets.1": { $exists: true }  // At least 2 different wallets
          }
        },
        // Step 5: Sort by first timestamp
        {
          $sort: { firstTimestamp: 1 }
        }
      ]).toArray();
      
      logger.info(`Found ${tokens.length} tokens with multiple wallets in timeframe for group ${groupId}`);
      
      // Format for easier processing
      const confluences = tokens.map(token => {
        // Find when the confluence was first detected (when the second wallet bought)
        const sortedTx = [...token.transactions].sort((a, b) => 
          new Date(a.timestamp) - new Date(b.timestamp)
        );
        
        // Find the timestamp when the second unique wallet appeared
        let detectionTimestamp = null;
        const walletsSeen = new Set();
        
        for (const tx of sortedTx) {
          walletsSeen.add(tx.walletName);
          
          // When we have 2 unique wallets, we have a confluence
          if (walletsSeen.size === 2) {
            detectionTimestamp = tx.timestamp;
            break;
          }
        }
        
        // If we couldn't determine detection time, use the first transaction
        if (!detectionTimestamp && sortedTx.length > 0) {
          detectionTimestamp = sortedTx[0].timestamp;
        }
        
        // Get a guaranteed token address if available in any transaction
        let bestTokenAddress = token._id.coinAddress;
        if (!bestTokenAddress) {
          // Look through all transactions to find any valid address
          for (const tx of token.transactions) {
            if (tx.coinAddress && tx.coinAddress.trim().length > 0) {
              bestTokenAddress = tx.coinAddress;
              break;
            }
          }
        }
        
        return {
          tokenName: token._id.coin,
          tokenAddress: bestTokenAddress, // Use the best available address
          detectionTimestamp: detectionTimestamp || token.firstTimestamp,
          detectionMarketCap: token.marketCap,
          totalUniqueWallets: token.wallets.length,
          wallets: token.wallets,
          transactions: token.transactions
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
        conf.tokenAddress && conf.tokenAddress.trim().length > 0 &&
        conf.tokenAddress.length >= 30 && 
        !conf.tokenAddress.startsWith('SIM')
      );
      
      if (confluencesWithAddresses.length === 0) {
        logger.warn('No confluences with valid token addresses found for performance analysis');
        return confluences;
      }
      
      // Prepare tokens data for performance analysis
      const tokensData = confluencesWithAddresses.map(conf => ({
        tokenAddress: conf.tokenAddress,
        tokenName: conf.tokenName,
        detectionTime: new Date(conf.detectionTimestamp),
        initialMarketCap: conf.detectionMarketCap
      }));
      
      // Get ATH data for each token
      const athResults = await birdeyeService.batchProcessATH(tokensData);
      
      // Map results back to confluences
      const enhancedConfluences = [...confluences];
      
      for (const result of athResults) {
        // Match by address first, which is more reliable
        const matchingConfIndex = enhancedConfluences.findIndex(
          conf => conf.tokenAddress === result.tokenAddress
        );
        
        if (matchingConfIndex >= 0) {
          enhancedConfluences[matchingConfIndex].performance = {
            percentageGain: result.athData.percentageGain,
            minutesToATH: result.athData.minutesToATH,
            timeToATHFormatted: result.athData.timeToATHFormatted,
            initialMarketCap: result.initialMarketCap,
            athMarketCap: result.athData.athMarketCap,
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
        
        // Categories based on gain
        const isProfit = gain > 0;
        const isSmallWin = gain >= 50;
        const isProfitable = gain >= 100;
        const isVeryProfitable = gain >= 200;
        const isExtremelyProfitable = gain >= 500;
        
        // Get first two wallets (they deserve more credit)
        const sortedTxs = [...conf.transactions || []].sort((a, b) => 
          new Date(a.timestamp) - new Date(b.timestamp)
        );
        
        const walletsByFirstAppearance = [];
        const walletsSeen = new Set();
        
        for (const tx of sortedTxs) {
          if (!walletsSeen.has(tx.walletName)) {
            walletsSeen.add(tx.walletName);
            walletsByFirstAppearance.push(tx.walletName);
            
            if (walletsByFirstAppearance.length >= 2) {
              break;
            }
          }
        }
        
        const earlyWallets = walletsByFirstAppearance.slice(0, 2);
        
        // Update stats for each wallet involved
        for (const wallet of conf.wallets) {
          if (!walletStats[wallet]) {
            walletStats[wallet] = {
              totalConfluences: 0,
              profitConfluences: 0,
              smallWinConfluences: 0,
              hitConfluences: 0,
              bigWinConfluences: 0,
              hugeWinConfluences: 0,
              earlyDetections: 0,
              totalGain: 0,
              weightedGain: 0,
              avgGain: 0,
              successRate: 0
            };
          }
          
          // Update wallet stats
          walletStats[wallet].totalConfluences++;
          
          // Add this confluence's gain to the wallet's total
          walletStats[wallet].totalGain += gain;
          
          // Apply weight boost for early wallets
          const isEarly = earlyWallets.includes(wallet);
          if (isEarly) {
            walletStats[wallet].earlyDetections++;
            walletStats[wallet].weightedGain += gain * 1.5;
          } else {
            walletStats[wallet].weightedGain += gain;
          }
          
          // Count by profit categories
          if (isProfit) {
            walletStats[wallet].profitConfluences++;
          }
          
          if (isSmallWin) {
            walletStats[wallet].smallWinConfluences++;
          }
          
          if (isProfitable) {
            walletStats[wallet].hitConfluences++;
          }
          
          if (isVeryProfitable) {
            walletStats[wallet].bigWinConfluences++;
          }
          
          if (isExtremelyProfitable) {
            walletStats[wallet].hugeWinConfluences++;
          }
          
          // Calculate averages
          walletStats[wallet].avgGain = walletStats[wallet].totalGain / walletStats[wallet].totalConfluences;
          walletStats[wallet].successRate = walletStats[wallet].profitConfluences / walletStats[wallet].totalConfluences;
        }
      }
      
      // Convert to array and sort by score
      return Object.entries(walletStats)
        .map(([wallet, stats]) => ({
          walletName: wallet,
          ...stats,
          score: (stats.hugeWinConfluences * 5) +
                 (stats.bigWinConfluences * 3) +
                 (stats.hitConfluences * 2) +
                 (stats.smallWinConfluences * 1) +
                 (stats.earlyDetections * 2) +
                 (stats.avgGain / 100)
        }))
        .sort((a, b) => b.score - a.score)
        .filter(wallet => wallet.totalConfluences >= 2);
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
  },

  /**
   * Get first confluence detected for each token in a group
   * @param {string} groupId - Group ID
   * @param {boolean} useTransactionCalc - Whether to use transaction calculation as fallback
   * @returns {Promise<Array>} Unique token confluences
   */
  async getFirstConfluencesPerToken(groupId, useTransactionCalc = true) {
    try {
      // Get confluences from DB first (more efficient)
      const dbConfluences = await confluenceDbService.getFirstConfluencesPerToken(groupId);
      
      if (dbConfluences && dbConfluences.length > 0) {
        logger.info(`Found ${dbConfluences.length} first confluences per token in database for group ${groupId}`);
        
        // Format to match expected structure
        return dbConfluences.map(conf => ({
          tokenName: conf.tokenSymbol,
          tokenAddress: conf.tokenAddress,
          detectionTimestamp: conf.timestamp,
          detectionMarketCap: conf.avgMarketCap,
          totalUniqueWallets: conf.count,
          wallets: conf.wallets.map(w => w.walletName || w.walletAddress),
          transactions: conf.wallets.map(wallet => ({
            walletName: wallet.walletName,
            type: wallet.type,
            amount: wallet.amount,
            baseAmount: wallet.baseAmount,
            timestamp: conf.timestamp
          }))
        }));
      }
      
      // Fallback to transaction-based calculation if needed and allowed
      if (useTransactionCalc) {
        logger.info(`No first confluences found in database, calculating from transactions for group ${groupId}`);
        const cutoffTime = new Date(Date.now() - (48 * 60 * 60 * 1000)); // 48 hours
        return this.getConfluencesInTimeframe(groupId, cutoffTime);
      }
      
      return [];
    } catch (error) {
      logger.error(`Error in getFirstConfluencesPerToken: ${error.message}`);
      return [];
    }
  }  
};

module.exports = recapService;