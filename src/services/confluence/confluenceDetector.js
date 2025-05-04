// src/services/confluence/confluenceDetector.js
const logger = require('../../utils/logger');
const performanceMonitor = require('../../utils/performanceMonitor');
const transactionService = require('../../db/services/transactionService');
const cacheManager = require('./cacheManager');
const groupSettingsManager = require('./groupSettingsManager');

// Keep track of startup time for recent transaction filtering
const startupTime = new Date();

/**
 * Core confluence detection logic - optimized for performance
 */
const confluenceDetector = {
  // Store metadata for older transactions
  olderTransactionsMetadata: {},

  /**
   * Process a token for confluence detection - optimized version
   * @param {string} tokenId - Token ID (address or name)
   * @param {Object} tokenInfo - Token information
   * @param {Array} confluences - Array to add detected confluences to
   * @returns {Promise<void>}
   */
  async processTokenConfluence(tokenId, tokenInfo, confluences) {
    try {
      const { 
        coin, 
        coinAddress, 
        buyTransactions, 
        sellTransactions, 
        groupId,
        olderBuyData,
        olderSellData
      } = tokenInfo;
      
      // Create a wallet Set for faster lookup performance
      const walletSet = new Set();
      
      // Get minimum wallets threshold early to allow for early exit
      const minWallets = await groupSettingsManager.getMinWalletsForGroup(groupId);
      
      // Track wallet addresses only once with a Set for better performance
      // Use a single pass through transactions rather than multiple loops
      for (const tx of buyTransactions) {
        walletSet.add(tx.walletAddress || tx.walletName);
        // Early exit check to reduce unnecessary processing
        if (walletSet.size >= minWallets) break;
      }
      
      // Continue adding sell transactions only if we haven't hit threshold
      if (walletSet.size < minWallets) {
        for (const tx of sellTransactions) {
          walletSet.add(tx.walletAddress || tx.walletName);
          if (walletSet.size >= minWallets) break;
        }
      }
      
      // Add older wallets to the set, if available
      if (walletSet.size < minWallets) {
        if (olderBuyData && olderBuyData.wallets) {
          for (const wallet of olderBuyData.wallets) {
            walletSet.add(wallet);
            if (walletSet.size >= minWallets) break;
          }
        }
        
        if (walletSet.size < minWallets && olderSellData && olderSellData.wallets) {
          for (const wallet of olderSellData.wallets) {
            walletSet.add(wallet);
            if (walletSet.size >= minWallets) break;
          }
        }
      }
      
      // Initial total count (including both cached and older transactions)
      const totalWalletCount = walletSet.size;
      
      // Early exit if not enough wallets - prevents unnecessary processing
      if (totalWalletCount < minWallets) {
        return;
      }
      
      // Pre-fetch additional data only if needed
      let additionalTransactions = [];
      const windowMinutes = await groupSettingsManager.getWindowMinutesForGroup(groupId);
      
      // Combine all current transactions for set operations
      const allTransactions = [...buyTransactions, ...sellTransactions];
      
      // Only fetch additional data if we've just crossed the threshold for detection
      // or if we have few in-memory transactions
      if (totalWalletCount === minWallets || allTransactions.length < 10) {
        // Optimize database query - only fetch if really needed
        try {
          if (coinAddress) {
            // Try loading by address first
            additionalTransactions = await transactionService.getRecentTransactionsByAddress(
              groupId, coinAddress, windowMinutes
            );
          } else if (coin) {
            // Fallback to loading by name
            additionalTransactions = await transactionService.getRecentTransactionsByCoin(
              groupId, coin, windowMinutes
            );
          }
        } catch (dbError) {
          logger.warn(`Error loading additional transactions: ${dbError.message}`);
        }
      }
      
      // Combine cached transactions with any additionally loaded ones - avoid duplicates
      // Use a Set-based approach to eliminate duplicates more efficiently
      const txMap = new Map();
      
      // Add all transactions we already have to the map
      for (const tx of allTransactions) {
        // Use a unique key for each transaction
        const txKey = `${tx.walletName}-${tx.timestamp}-${tx.amount}`;
        txMap.set(txKey, tx);
      }
      
      // Add additional transactions that aren't already in the map
      for (const tx of additionalTransactions) {
        const txKey = `${tx.walletName}-${tx.timestamp}-${tx.amount}`;
        if (!txMap.has(txKey)) {
          txMap.set(txKey, tx);
        }
      }
      
      // Get the combined transactions array
      const combinedTransactions = Array.from(txMap.values());
      
      // Add metadata transactions only if we have no real transactions but have metadata
      if (combinedTransactions.length === 0) {
        if (olderBuyData || olderSellData) {
          if (olderBuyData) {
            // Calculate average values once - avoid repeated div operations
            const avgAmount = olderBuyData.totalAmount / olderBuyData.wallets.length;
            const avgBaseAmount = olderBuyData.totalBaseAmount / olderBuyData.wallets.length;
            
            olderBuyData.wallets.forEach(wallet => {
              combinedTransactions.push({
                walletName: wallet,
                coin: olderBuyData.coin,
                coinAddress: olderBuyData.coinAddress,
                amount: avgAmount,
                type: 'buy',
                timestamp: olderBuyData.newestTimestamp,
                baseAmount: avgBaseAmount,
                isMetadataTransaction: true
              });
            });
          }
          
          if (olderSellData) {
            const avgAmount = olderSellData.totalAmount / olderSellData.wallets.length;
            const avgBaseAmount = olderSellData.totalBaseAmount / olderSellData.wallets.length;
            
            olderSellData.wallets.forEach(wallet => {
              combinedTransactions.push({
                walletName: wallet,
                coin: olderSellData.coin,
                coinAddress: olderSellData.coinAddress,
                amount: avgAmount,
                type: 'sell',
                timestamp: olderSellData.newestTimestamp,
                baseAmount: avgBaseAmount,
                isMetadataTransaction: true
              });
            });
          }
        }
      }
      
      // Skip if still no transactions
      if (combinedTransactions.length === 0) return;
      
      // Generate a unique key for this token's confluence
      const confluenceKey = coinAddress && coinAddress.length > 0 
        ? `${groupId}_addr_${coinAddress}` // Remove transaction type from key
        : `${groupId}_name_${coin}`;
        
      // Get existing confluence for this token - reuse if already detected
      const existingConfluence = await cacheManager.detectedConfluences.get(confluenceKey) || { wallets: [] };
      
      // Process all transactions and create a wallet map
      // Use Map for better performance on large datasets
      const walletMap = new Map();
      
      // First, process existing wallets to maintain their order
      // Precompute all existing wallet IDs for faster lookups
      const existingWalletIds = new Set(
        existingConfluence.wallets.map(w => w.walletAddress || w.walletName)
      );
      
      existingConfluence.wallets.forEach(wallet => {
        // Use address as ID when available, fallback to name
        const walletId = wallet.walletAddress || wallet.walletName;
        
        walletMap.set(walletId, {
          ...wallet,
          amount: 0,
          usdValue: 0,
          baseAmount: 0,
          marketCap: 0,
          buyAmount: 0,
          sellAmount: 0,
          buyBaseAmount: 0,
          sellBaseAmount: 0,
          transactions: [],
          isUpdated: false,
          type: wallet.type // Preserve original type
        });
      });
      
      // Sort all transactions by timestamp - do this once
      const sortedTransactions = combinedTransactions.sort((a, b) => 
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
      
      // Process all transactions in a single pass
      for (const tx of sortedTransactions) {
        // Skip transactions without a valid type
        if (!tx.type) {
          logger.warn(`Transaction without type for ${tx.walletName}, skipping`);
          continue;
        }
        
        // Get wallet identifier (prefer address, fallback to name)
        const walletId = tx.walletAddress || tx.walletName;
        
        if (!walletMap.has(walletId)) {
          // New wallet - not seen before
          walletMap.set(walletId, {
            walletName: tx.walletName,
            walletAddress: tx.walletAddress,
            amount: tx.amount,
            usdValue: tx.usdValue || 0,
            timestamp: tx.timestamp,
            marketCap: tx.marketCap || 0,
            baseAmount: tx.baseAmount || 0,
            baseSymbol: tx.baseSymbol || '',
            type: tx.type,  // Initial type
            buyAmount: tx.type === 'buy' ? tx.amount : 0,
            sellAmount: tx.type === 'sell' ? tx.amount : 0,
            buyBaseAmount: tx.type === 'buy' ? (tx.baseAmount || 0) : 0,
            sellBaseAmount: tx.type === 'sell' ? (tx.baseAmount || 0) : 0,
            transactions: [tx],
            isUpdated: existingWalletIds.has(walletId), // Mark as updated if it exists in previous confluence
            isFromMetadata: !!tx.isMetadataTransaction
          });
        } else {
          // Existing wallet - update its data based on transaction type
          const wallet = walletMap.get(walletId);
          
          // Always add the transaction to the wallet's transaction history
          wallet.transactions.push(tx);
          
          // Update the latest type (for update detection purposes), but preserve transaction history
          const previousType = wallet.type;
          wallet.type = tx.type;
          
          // Update wallet address if it wasn't set before
          if (!wallet.walletAddress && tx.walletAddress) {
            wallet.walletAddress = tx.walletAddress;
          }
          
          // Track buy and sell amounts separately
          if (tx.type === 'buy') {
            wallet.buyAmount = (wallet.buyAmount || 0) + tx.amount;
            wallet.buyBaseAmount = (wallet.buyBaseAmount || 0) + (tx.baseAmount || 0);
          } else if (tx.type === 'sell') {
            wallet.sellAmount = (wallet.sellAmount || 0) + tx.amount;
            wallet.sellBaseAmount = (wallet.sellBaseAmount || 0) + (tx.baseAmount || 0);
          }
          
          // Update values
          wallet.amount += tx.amount;
          wallet.usdValue += tx.usdValue || 0;
          wallet.baseAmount += tx.baseAmount || 0;
          
          // Update market cap calculation with weighted average
          if (tx.marketCap > 0 && tx.baseAmount > 0) {
            const oldWeight = wallet.baseAmount - tx.baseAmount;
            const newWeight = tx.baseAmount;
            const totalWeight = wallet.baseAmount;
            
            if (totalWeight > 0) {
              wallet.marketCap = 
                ((wallet.marketCap * oldWeight) + 
                (tx.marketCap * newWeight)) / totalWeight;
            } else {
              wallet.marketCap = tx.marketCap;
            }
          }
          
          // Check for updates more efficiently
          // Mark as updated if new transaction is of a different type or adds significant value
          if (existingWalletIds.has(walletId)) {
            const previousWallet = existingConfluence.wallets.find(w => (w.walletAddress || w.walletName) === walletId);
            if (previousWallet && 
                (previousType !== wallet.type || 
                 Math.abs(previousWallet.baseAmount - wallet.baseAmount) > 0.01)) {
              wallet.isUpdated = true;
            }
          }
          
          // Mark if this contains metadata transactions
          if (tx.isMetadataTransaction) {
            wallet.isFromMetadata = true;
          }
        }
      }
      
      // Convert the wallet map to an array, preserving order of appearance
      let wallets = [];
      
      // First add existing wallets in their original order
      existingConfluence.wallets.forEach(existingWallet => {
        const walletId = existingWallet.walletAddress || existingWallet.walletName;
        const updatedWallet = walletMap.get(walletId);
        if (updatedWallet && updatedWallet.transactions.length > 0) {
          wallets.push(updatedWallet);
        }
      });
      
      // Then add new wallets - only need to worry about wallets not already processed
      const newWallets = [];
      walletMap.forEach((wallet, id) => {
        if (!existingWalletIds.has(id) && wallet.transactions.length > 0) {
          newWallets.push(wallet);
        }
      });
      
      // Only sort if needed - avoid expensive operations
      if (newWallets.length > 1) {
        // Sort by first transaction timestamp
        newWallets.sort((a, b) => {
          const aFirstTx = a.transactions.reduce((earliest, tx) => 
            new Date(tx.timestamp) < new Date(earliest.timestamp) ? tx : earliest, a.transactions[0]);
          const bFirstTx = b.transactions.reduce((earliest, tx) => 
            new Date(tx.timestamp) < new Date(earliest.timestamp) ? tx : earliest, b.transactions[0]);
          return new Date(aFirstTx.timestamp).getTime() - new Date(bFirstTx.timestamp).getTime();
        });
      }
      
      wallets = [...wallets, ...newWallets];
      
      // Check if enough different wallets made a transaction
      const totalUniqueWallets = wallets.length;
      
      if (totalUniqueWallets >= minWallets) {
        const isUpdate = existingConfluence.wallets.length > 0;
        
        // Count real transactions (not from metadata) - avoid unnecessary filtering by using a counter
        let nonMetadataCount = 0;
        for (const wallet of wallets) {
          if (!wallet.isFromMetadata) {
            nonMetadataCount++;
          }
        }
        
        // Determine the primary transaction type based on most recent activity
        // Count once instead of filtering twice
        let buyWallets = 0;
        let sellWallets = 0;
        
        for (const wallet of wallets) {
          if (wallet.buyBaseAmount > 0) buyWallets++;
          if (wallet.sellBaseAmount > 0) sellWallets++;
        }
        
        const primaryType = buyWallets >= sellWallets ? 'buy' : 'sell';
        
        // Pre-calculate summary stats in a single pass
        let totalAmount = 0;
        let totalUsdValue = 0;
        let totalBaseAmount = 0;
        let totalMarketCap = 0;
        let updatedWalletCount = 0;
        
        for (const wallet of wallets) {
          totalAmount += wallet.amount;
          totalUsdValue += (wallet.usdValue || 0);
          totalBaseAmount += (wallet.baseAmount || 0);
          totalMarketCap += (wallet.marketCap || 0);
          
          if (wallet.isUpdated) {
            updatedWalletCount++;
          }
        }
        
        // Create the confluence object
        const confluence = {
          type: primaryType, // Primary type for the message emoji
          coin,
          coinAddress,
          wallets,
          count: totalUniqueWallets,
          nonMetadataCount,
          totalAmount,
          totalUsdValue,
          totalBaseAmount,
          avgMarketCap: totalMarketCap / wallets.length,
          timestamp: new Date(),
          groupId,
          isUpdate,
          buyCount: buyWallets,
          sellCount: sellWallets,
          // Add 48h window flag
          is48hWindow: nonMetadataCount < minWallets && totalUniqueWallets >= minWallets
        };
        
        // Save this confluence for future reference
        await cacheManager.detectedConfluences.set(confluenceKey, confluence);
        
        // Only send updates if something has changed
        if (isUpdate) {
          // Only add to results if at least one wallet was updated
          if (updatedWalletCount > 0) {
            confluences.push(confluence);
          }
        } else {
          // New confluence
          confluences.push(confluence);
        }
      }
    } catch (error) {
      logger.error(`Error processing token confluence for ${tokenId}: ${error.message}`);
    }
  },

  /**
   * Check for confluences - optimized for performance
   * @param {string} groupId - Group ID
   * @returns {Promise<Array>} - List of detected confluences
   */
  async checkConfluences(groupId = 'default') {
    // Start measuring performance
    const perfTimer = performanceMonitor.startTimer();
    
    try {
      const confluences = [];
      const detectedTokens = new Map(); // Map to track tokens by their address or name
      
      // Get cache keys once
      const keys = await cacheManager.transactionsCache.keys();
      
      // Filter keys for this group - more efficient string checking
      const groupPrefix = `${groupId}_`;
      const groupKeys = keys.filter(key => key.startsWith(groupPrefix));
      
      // Debug log for monitoring
      if (groupKeys.length > 100) {
        logger.warn(`Large number of cache keys for group ${groupId}: ${groupKeys.length} keys`);
      }
      
      // Get all transactions at once for better performance
      const keyTransactionMap = {};
      const getPromises = [];
      
      // Start measuring cache retrieval performance
      const cacheTimer = performanceMonitor.startTimer();
      
      // Batch cache retrieval for better performance
      // Process in chunks to avoid memory pressure
      const BATCH_SIZE = 25; // Process 25 keys at a time
      for (let i = 0; i < groupKeys.length; i += BATCH_SIZE) {
        const batchKeys = groupKeys.slice(i, i + BATCH_SIZE);
        const batchPromises = batchKeys.map(key => 
          cacheManager.transactionsCache.get(key)
            .then(transactions => {
              if (transactions) {
                keyTransactionMap[key] = transactions;
              }
            })
        );
        
        // Wait for each batch to complete
        await Promise.all(batchPromises);
      }
      
      // End measuring cache performance
      performanceMonitor.endTimer(cacheTimer, 'transactionProcessing', `cache_retrieval_${groupId}`);
      
      // First pass: identify all tokens and their information from cache
      // Use a Map for token info to optimize lookup performance
      const tokenInfoMap = new Map();
      
      for (const key of groupKeys) {
        // Extract info from key
        const parts = key.split('_');
        const type = parts[1]; // buy or sell
        let coin, coinAddress;
        
        if (parts[2] === 'addr') {
          coinAddress = parts[3];
          coin = ''; 
        } else if (parts[2] === 'name') {
          coin = parts[3];
          coinAddress = '';
        }
        
        const transactions = keyTransactionMap[key] || [];
        
        // Skip if no transactions
        if (transactions.length === 0) continue;
        
        // Get coin name from transactions if missing
        if (!coin && coinAddress && transactions.length > 0) {
          coin = transactions[0].coin;
        }
        
        // Create a unified token identifier (prefer address, fallback to name)
        const tokenId = coinAddress && coinAddress.length > 0 ? coinAddress : coin;
        
        // Store token info
        if (!tokenInfoMap.has(tokenId)) {
          tokenInfoMap.set(tokenId, {
            coin: coin,
            coinAddress: coinAddress,
            buyTransactions: [],
            sellTransactions: [],
            groupId: groupId,
            // Add metadata for older transactions
            olderBuyData: null,
            olderSellData: null
          });
        }
        
        // Add transactions to the appropriate array
        const tokenInfo = tokenInfoMap.get(tokenId);
        if (type === 'buy') {
          tokenInfo.buyTransactions.push(...transactions);
        } else if (type === 'sell') {
          tokenInfo.sellTransactions.push(...transactions);
        }
      }
      
      // Add older transactions metadata to the detected tokens
      if (this.olderTransactionsMetadata) {
        // Only process relevant keys for this group
        Object.entries(this.olderTransactionsMetadata).forEach(([key, metadata]) => {
          // Only process keys for this group
          if (!key.startsWith(groupPrefix)) return;
          
          // Extract info from key
          const parts = key.split('_');
          const type = parts[1]; // buy or sell
          const idType = parts[2]; // addr or name 
          const tokenIdentifier = parts[3]; // the actual address or name
          
          // Find the corresponding token
          let tokenId;
          if (idType === 'addr') {
            tokenId = tokenIdentifier;
          } else {
            tokenId = metadata.coin; // Use the name
          }
          
          if (!tokenId) return;
          
          // Get or create token info
          if (!tokenInfoMap.has(tokenId)) {
            tokenInfoMap.set(tokenId, {
              coin: metadata.coin,
              coinAddress: metadata.coinAddress,
              buyTransactions: [],
              sellTransactions: [],
              groupId: groupId,
              olderBuyData: null,
              olderSellData: null
            });
          }
          
          const tokenInfo = tokenInfoMap.get(tokenId);
          
          // Add older transaction metadata
          if (type === 'buy') {
            tokenInfo.olderBuyData = metadata;
          } else if (type === 'sell') {
            tokenInfo.olderSellData = metadata;
          }
        });
      }
      
      // Process tokens in parallel for better performance
      const processPromises = [];
      
      // Process in batches to control concurrency
      const CONCURRENCY_LIMIT = 5;
      const tokenEntries = Array.from(tokenInfoMap.entries());
      
      // Process tokens in batches to avoid memory issues
      for (let i = 0; i < tokenEntries.length; i += CONCURRENCY_LIMIT) {
        const batch = tokenEntries.slice(i, i + CONCURRENCY_LIMIT);
        const batchPromises = batch.map(([tokenId, tokenInfo]) => 
          this.processTokenConfluence(tokenId, tokenInfo, confluences)
        );
        
        await Promise.all(batchPromises);
        
        // Add a small delay between batches to prevent event loop starvation
        if (i + CONCURRENCY_LIMIT < tokenEntries.length) {
          await new Promise(resolve => setTimeout(resolve, 5));
        }
      }
      
      // End timing the entire confluence detection process
      const totalTime = performanceMonitor.endTimer(perfTimer, 'confluenceDetection', `check_group_${groupId}`);
      
      // Log performance for transparency
      if (confluences.length > 0) {
        logger.info(`Confluence detection for group ${groupId} completed in ${totalTime.toFixed(2)}ms, found ${confluences.length} confluences`);
      } else if (totalTime > 500) {
        // Only log if it took some time but found nothing
        logger.debug(`Confluence detection for group ${groupId} completed in ${totalTime.toFixed(2)}ms, no confluences found`);
      }
      
      return confluences;
    } catch (error) {
      logger.error('Error checking confluences:', error);
      
      // End timing even if there was an error
      performanceMonitor.endTimer(perfTimer, 'confluenceDetection', `check_group_${groupId}_error`);
      
      return [];
    }
  }
};

module.exports = confluenceDetector;