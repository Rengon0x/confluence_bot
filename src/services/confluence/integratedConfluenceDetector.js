// src/services/confluence/integratedConfluenceDetector.js
const logger = require('../../utils/logger');
const performanceMonitor = require('../../utils/performanceMonitor');
const confluenceDbService = require('../../db/services/confluenceDbService');
const transactionService = require('../../db/services/transactionService');
const cacheManager = require('./cacheManager');
const groupSettingsManager = require('./groupSettingsManager');
const confluenceDetector = require('./confluenceDetector');

/**
 * Enhanced confluence detection with database persistence
 * This integrates the optimized in-memory detection with database storage
 * for faster performance in high-volume scenarios
 */
const integratedConfluenceDetector = {
  /**
   * Check for confluences, utilizing database-stored confluences when available
   * This is the main entry point for confluence detection with high performance
   * @param {string} groupId - Group ID
   * @param {Object} transactionInfo - Optional information about the current transaction
   * @returns {Promise<Array>} - List of detected confluences
   */
  async checkConfluences(groupId = 'default', transactionInfo = null) {
    // Start measuring performance
    const perfTimer = performanceMonitor.startTimer();
    
    try {
      // Path 1: Fast path for direct token lookup when transaction info is available
      if (transactionInfo) {
        const { coin, coinAddress } = transactionInfo;
        
        if (coin || coinAddress) {
          // Start a timer for database lookup
          const dbLookupTimer = performanceMonitor.startTimer();
          
          // Try to find an existing confluence
          const existingConfluence = await confluenceDbService.findConfluence(
            groupId, 
            coinAddress, 
            coin
          );
          
          // End DB lookup timer
          performanceMonitor.endTimer(dbLookupTimer, 'mongoQueries', `find_confluence_${groupId}`);
          
          if (existingConfluence) {
            logger.debug(`Found existing confluence for ${coin || coinAddress} in group ${groupId}`);
            
            // Check if we need to add this transaction's wallet to the confluence
            const walletId = transactionInfo.walletAddress || transactionInfo.walletName;
            
            // Check if wallet is already in the confluence
            const existingWallet = existingConfluence.wallets.find(w => 
              (w.walletAddress && w.walletAddress === transactionInfo.walletAddress) ||
              (w.walletName === transactionInfo.walletName)
            );
            
            // New wallet for existing confluence - important event!
            if (!existingWallet) {
              logger.info(`New wallet ${walletId} detected for existing confluence of ${coin || coinAddress}`);
              
              // Prepare wallet object for addition
              const newWallet = {
                walletName: transactionInfo.walletName,
                walletAddress: transactionInfo.walletAddress,
                amount: transactionInfo.amount,
                usdValue: transactionInfo.usdValue || 0,
                timestamp: transactionInfo.timestamp,
                marketCap: transactionInfo.marketCap || 0,
                baseAmount: transactionInfo.baseAmount || 0,
                baseSymbol: transactionInfo.baseSymbol || '',
                type: transactionInfo.type,
                buyAmount: transactionInfo.type === 'buy' ? transactionInfo.amount : 0,
                sellAmount: transactionInfo.type === 'sell' ? transactionInfo.amount : 0,
                buyBaseAmount: transactionInfo.type === 'buy' ? (transactionInfo.baseAmount || 0) : 0,
                sellBaseAmount: transactionInfo.type === 'sell' ? (transactionInfo.baseAmount || 0) : 0,
                isUpdated: true,
                isFromMetadata: false
              };
              
              // Add wallet to the database confluence (fast operation)
              await confluenceDbService.addWalletToConfluence(
                groupId,
                coinAddress,
                coin,
                newWallet
              );
              
              // Update the confluence for the cache as well
              const updatedWallets = [...existingConfluence.wallets, newWallet];
              
              // Create an updated confluence for the response
              const updatedConfluence = {
                ...existingConfluence,
                wallets: updatedWallets,
                count: existingConfluence.count + 1,
                nonMetadataCount: existingConfluence.nonMetadataCount + 1,
                totalAmount: existingConfluence.totalAmount + (transactionInfo.amount || 0),
                totalUsdValue: existingConfluence.totalUsdValue + (transactionInfo.usdValue || 0),
                totalBaseAmount: existingConfluence.totalBaseAmount + (transactionInfo.baseAmount || 0),
                isUpdate: true,
                timestamp: new Date()
              };
              
              // Update buy/sell counts
              if (transactionInfo.type === 'buy') {
                updatedConfluence.buyCount = (existingConfluence.buyCount || 0) + 1;
              } else if (transactionInfo.type === 'sell') {
                updatedConfluence.sellCount = (existingConfluence.sellCount || 0) + 1;
              }
              
              // Recalculate primary type based on latest counts
              updatedConfluence.type = (updatedConfluence.buyCount || 0) >= (updatedConfluence.sellCount || 0) ? 'buy' : 'sell';
              
              // Update cache with the new confluence
              const confluenceKey = coinAddress ? 
                `${groupId}_addr_${coinAddress}` : 
                `${groupId}_name_${coin}`;
              
              await cacheManager.detectedConfluences.set(confluenceKey, updatedConfluence);
              
              // End timing
              const totalTime = performanceMonitor.endTimer(perfTimer, 'confluenceDetection', `optimized_check_${groupId}`);
              logger.info(`Optimized confluence detection for ${coin || coinAddress} in group ${groupId} completed in ${totalTime.toFixed(2)}ms - wallet added to existing confluence`);
              
              // Return the updated confluence as an array of 1 element
              return [updatedConfluence];
            } 
            // Wallet already exists in confluence but transaction type may have changed
            else {
              logger.debug(`Wallet ${walletId} already exists in confluence for ${coin || coinAddress}`);
              
              // Check if this is a different transaction type that might warrant an update
              if (existingWallet.type !== transactionInfo.type) {
                logger.info(`Wallet ${walletId} has a new transaction type for ${coin || coinAddress}: ${transactionInfo.type}`);
                
                // This is a significant update - prepare update information
                const updates = {
                  type: transactionInfo.type,
                  amount: transactionInfo.amount,
                  usdValue: transactionInfo.usdValue || 0,
                  baseAmount: transactionInfo.baseAmount || 0,
                  baseSymbol: transactionInfo.baseSymbol || ''
                };
                
                // Update wallet in database
                await confluenceDbService.updateWalletInConfluence(
                  groupId, 
                  coinAddress, 
                  coin, 
                  walletId, 
                  updates
                );
                
                // Also recalculate primary type
                await confluenceDbService.recalculatePrimaryType(
                  groupId,
                  coinAddress,
                  coin
                );
                
                // Fetch the updated confluence for the response
                const updatedConfluence = await confluenceDbService.findConfluence(
                  groupId,
                  coinAddress,
                  coin
                );
                
                if (updatedConfluence) {
                  // Update cache with the new confluence
                  const confluenceKey = coinAddress ? 
                    `${groupId}_addr_${coinAddress}` : 
                    `${groupId}_name_${coin}`;
                  
                  await cacheManager.detectedConfluences.set(confluenceKey, updatedConfluence);
                  
                  // End timing
                  const totalTime = performanceMonitor.endTimer(perfTimer, 'confluenceDetection', `optimized_check_${groupId}`);
                  logger.info(`Optimized confluence detection for ${coin || coinAddress} in group ${groupId} completed in ${totalTime.toFixed(2)}ms - wallet transaction type updated`);
                  
                  // Return the updated confluence as an array of 1 element
                  return [updatedConfluence];
                }
              }
              
              // No update needed - end timing and return empty array
              performanceMonitor.endTimer(perfTimer, 'confluenceDetection', `no_update_needed_${groupId}`);
              return [];
            }
          }
          
          // No existing confluence found - check if we might need to create a new one
          // with the standard detection algorithm
        }
      }
      
      // Path 2: Standard detection path - required for new confluences or when no transaction context
      logger.debug(`No existing confluence found, running standard detection for group ${groupId}`);
      
      // Use the standard confluence detector for the full algorithm
      const confluences = await confluenceDetector.checkConfluences(groupId);
      
      // If confluences are found, store them in the database for future optimized lookups
      if (confluences.length > 0) {
        logger.info(`Storing ${confluences.length} new confluences in database for group ${groupId}`);
        
        // Store each confluence in the database
        const storePromises = confluences.map(confluence => 
          confluenceDbService.storeConfluence(confluence)
            .catch(err => logger.error(`Error storing confluence for ${confluence.coin || confluence.coinAddress}: ${err.message}`))
        );
        
        // Wait for all stores to complete
        await Promise.all(storePromises);
      }
      
      // End timing the entire confluence detection process
      const totalTime = performanceMonitor.endTimer(perfTimer, 'confluenceDetection', `standard_check_${groupId}`);
      
      // Log performance for transparency
      if (confluences.length > 0) {
        logger.info(`Integrated confluence detection for group ${groupId} completed in ${totalTime.toFixed(2)}ms, found ${confluences.length} confluences`);
      } else if (totalTime > 500) {
        // Only log if it took some time but found nothing
        logger.debug(`Integrated confluence detection for group ${groupId} completed in ${totalTime.toFixed(2)}ms, no confluences found`);
      }
      
      return confluences;
    } catch (error) {
      logger.error('Error in integrated confluence detection:', error);
      
      // End timing even if there was an error
      performanceMonitor.endTimer(perfTimer, 'confluenceDetection', `check_group_${groupId}_error`);
      
      // Fallback to standard detection in case of errors
      logger.warn(`Falling back to standard confluence detection for group ${groupId}`);
      return confluenceDetector.checkConfluences(groupId);
    }
  },
  
  /**
   * Initialize the integrated detector
   * Sets up database and memory components
   */
  async initialize() {
    try {
      // Initialize the confluence detector and preload active confluences
      await this.preloadActiveConfluences();
      
      // Schedule periodic database cleanup and synchronization
      this.startPeriodicTasks();
      
      logger.info('Integrated confluence detector initialized');
    } catch (error) {
      logger.error(`Error initializing integrated confluence detector: ${error.message}`);
    }
  },
  
  /**
   * Preload active confluences from database into memory cache
   * This improves initial performance by avoiding database hits
   */
  async preloadActiveConfluences() {
    try {
      // Get all groups
      const groups = await require('../../db/services/groupService').getAllActive();
      
      if (!groups || groups.length === 0) {
        logger.info('No active groups found for preloading confluences');
        return;
      }
      
      logger.info(`Preloading confluences for ${groups.length} active groups`);
      
      // Load recent confluences for each group
      let totalLoaded = 0;
      
      for (const group of groups) {
        try {
          const groupId = group.groupId;
          const confluences = await confluenceDbService.getRecentConfluences(groupId, 50);
          
          if (confluences.length > 0) {
            logger.debug(`Preloaded ${confluences.length} confluences for group ${groupId}`);
            
            // Store in cache for faster access
            for (const confluence of confluences) {
              const cacheKey = confluence.tokenAddress && confluence.tokenAddress.length > 0 
                ? `${groupId}_addr_${confluence.tokenAddress}` 
                : `${groupId}_name_${confluence.tokenSymbol}`;
                
              await cacheManager.detectedConfluences.set(cacheKey, confluence);
            }
            
            totalLoaded += confluences.length;
          }
        } catch (groupError) {
          logger.error(`Error preloading confluences for group ${group.groupId}: ${groupError.message}`);
        }
      }
      
      logger.info(`Preloaded ${totalLoaded} total confluences into memory cache`);
    } catch (error) {
      logger.error(`Error in preloadActiveConfluences: ${error.message}`);
    }
  },
  
  /**
   * Start periodic tasks for database maintenance
   */
  startPeriodicTasks() {
    // Cleanup old confluences every hour
    setInterval(async () => {
      try {
        const deactivated = await confluenceDbService.deactivateOldConfluences(48);
        if (deactivated > 0) {
          logger.info(`Periodic task: Deactivated ${deactivated} old confluences`);
        }
      } catch (error) {
        logger.error(`Error in confluence cleanup task: ${error.message}`);
      }
    }, 60 * 60 * 1000); // Every hour
    
    // Synchronize in-memory cache with database every 5 minutes
    setInterval(async () => {
      try {
        await this.syncCacheWithDatabase();
      } catch (error) {
        logger.error(`Error in cache synchronization task: ${error.message}`);
      }
    }, 5 * 60 * 1000); // Every 5 minutes
  },
  
  /**
   * Synchronize in-memory cache with database
   * Ensures consistency between the two data stores
   */
  async syncCacheWithDatabase() {
    try {
      // Get all groups
      const groups = await require('../../db/services/groupService').getAllActive();
      
      if (!groups || groups.length === 0) {
        return;
      }
      
      // Process each group
      for (const group of groups) {
        try {
          const groupId = group.groupId;
          
          // Get confluence keys from cache for this group
          const keys = await cacheManager.detectedConfluences.keys();
          const groupPrefix = `${groupId}_`;
          const groupKeys = keys.filter(key => key.startsWith(groupPrefix));
          
          if (groupKeys.length === 0) {
            continue;
          }
          
          // Get active confluences from database
          const dbConfluences = await confluenceDbService.getRecentConfluences(groupId, 50);
          
          // Create maps for easier lookups
          const dbConfluenceMap = new Map();
          for (const conf of dbConfluences) {
            // Create cache-compatible keys
            if (conf.tokenAddress) {
              dbConfluenceMap.set(`${groupId}_addr_${conf.tokenAddress}`, conf);
            } else if (conf.tokenSymbol) {
              dbConfluenceMap.set(`${groupId}_name_${conf.tokenSymbol}`, conf);
            }
          }
          
          // Compare and update cache
          let updates = 0;
          
          for (const key of groupKeys) {
            const cachedConfluence = await cacheManager.detectedConfluences.get(key);
            
            if (!cachedConfluence) continue;
            
            // Check if this confluence exists in the database
            if (dbConfluenceMap.has(key)) {
              const dbConfluence = dbConfluenceMap.get(key);
              
              // Compare last updated times
              const cachedTime = new Date(cachedConfluence.timestamp || cachedConfluence.lastUpdated).getTime();
              const dbTime = new Date(dbConfluence.lastUpdated).getTime();
              
              // If database version is newer, update cache
              if (dbTime > cachedTime) {
                await cacheManager.detectedConfluences.set(key, dbConfluence);
                updates++;
              }
              // If memory version is newer, update database
              else if (cachedTime > dbTime) {
                await confluenceDbService.storeConfluence(cachedConfluence);
                updates++;
              }
            }
            // If not in database, add it
            else {
              await confluenceDbService.storeConfluence(cachedConfluence);
              updates++;
            }
          }
          
          if (updates > 0) {
            logger.debug(`Synchronized ${updates} confluences for group ${groupId}`);
          }
        } catch (groupError) {
          logger.error(`Error synchronizing confluences for group ${group.groupId}: ${groupError.message}`);
        }
      }
    } catch (error) {
      logger.error(`Error in syncCacheWithDatabase: ${error.message}`);
    }
  }
};

module.exports = integratedConfluenceDetector;