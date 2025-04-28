// src/services/confluence/confluenceDetector.js
const logger = require('../../utils/logger');
const performanceMonitor = require('../../utils/performanceMonitor');
const transactionService = require('../../db/services/transactionService');
const cacheManager = require('./cacheManager');
const groupSettingsManager = require('./groupSettingsManager');

// Keep track of startup time for recent transaction filtering
const startupTime = new Date();

/**
 * Core confluence detection logic
 */
const confluenceDetector = {
  // Store metadata for older transactions
  olderTransactionsMetadata: {},

  /**
   * Process a token for confluence detection
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
      
      // Create a wallet count tracker
      const walletTracker = new Map();
      
      // Count cached transactions wallets
      const allTransactions = [...buyTransactions, ...sellTransactions];
      allTransactions.forEach(tx => {
        const walletId = tx.walletAddress || tx.walletName;
        walletTracker.set(walletId, true);
      });
      
      // Count older buy transactions wallets
      if (olderBuyData && olderBuyData.wallets) {
        olderBuyData.wallets.forEach(wallet => {
          walletTracker.set(wallet, true);
        });
      }
      
      // Count older sell transactions wallets
      if (olderSellData && olderSellData.wallets) {
        olderSellData.wallets.forEach(wallet => {
          walletTracker.set(wallet, true);
        });
      }
      
      // Initial total count (including both cached and older transactions)
      const totalWalletCount = walletTracker.size;
      
      // Check if we need to fetch additional data from MongoDB
      const minWallets = await groupSettingsManager.getMinWalletsForGroup(groupId);
      let additionalTransactions = [];
      
      // Get the specific window for this group
      const windowMinutes = await groupSettingsManager.getWindowMinutesForGroup(groupId);
      
      // If we have few cached transactions but lots of older ones, we might need to load more data
      if (allTransactions.length === 0 || (totalWalletCount >= minWallets && allTransactions.length < 10)) {
        // Fetch from MongoDB to fill in details not in cache
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
      
      // Combine cached transactions with any additionally loaded ones
      const combinedTransactions = [...allTransactions];
      
      // Add additional transactions that aren't already in cache
      for (const tx of additionalTransactions) {
        const isDuplicate = combinedTransactions.some(
          existingTx => 
            existingTx.walletName === tx.walletName && 
            existingTx.timestamp === tx.timestamp &&
            existingTx.amount === tx.amount
        );
        
        if (!isDuplicate) {
          combinedTransactions.push(tx);
        }
      }
      
      if (combinedTransactions.length === 0) {
        // If we still have no transactions but have metadata, create placeholder transactions
        if (olderBuyData || olderSellData) {
          
          if (olderBuyData) {
            olderBuyData.wallets.forEach(wallet => {
              combinedTransactions.push({
                walletName: wallet,
                coin: olderBuyData.coin,
                coinAddress: olderBuyData.coinAddress,
                amount: olderBuyData.totalAmount / olderBuyData.wallets.length, // average amount
                type: 'buy',
                timestamp: olderBuyData.newestTimestamp,
                baseAmount: olderBuyData.totalBaseAmount / olderBuyData.wallets.length, // average base amount
                isMetadataTransaction: true
              });
            });
          }
          
          if (olderSellData) {
            olderSellData.wallets.forEach(wallet => {
              combinedTransactions.push({
                walletName: wallet,
                coin: olderSellData.coin,
                coinAddress: olderSellData.coinAddress,
                amount: olderSellData.totalAmount / olderSellData.wallets.length, // average amount
                type: 'sell',
                timestamp: olderSellData.newestTimestamp,
                baseAmount: olderSellData.totalBaseAmount / olderSellData.wallets.length, // average base amount
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
        
      // Get existing confluence for this token
      const existingConfluence = await cacheManager.detectedConfluences.get(confluenceKey) || { wallets: [] };
      
      // Process all transactions and create a wallet map
      const walletMap = new Map();
      
      // First, process existing wallets to maintain their order
      existingConfluence.wallets.forEach(wallet => {
        walletMap.set(wallet.walletName, {
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
      
      // Sort all transactions by timestamp
      const sortedTransactions = [...combinedTransactions].sort((a, b) => 
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
      
      // Process all transactions
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
            isUpdated: existingConfluence.wallets.length > 0, // Mark as updated if it's a new wallet in an existing confluence
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
          
          // Update market cap calculation
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
          
          // Mark as updated if new transaction is of a different type or adds significant value
          const previousWallet = existingConfluence.wallets.find(w => w.walletName === wallet.walletName);
          if (previousWallet) {
            if (previousType !== wallet.type || 
                Math.abs(previousWallet.baseAmount - wallet.baseAmount) > 0.01) {
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
      
      // Then add new wallets in order of their first transaction
      const newWalletIds = [...walletMap.keys()].filter(
        id => !existingConfluence.wallets.some(w => (w.walletAddress || w.walletName) === id)
      );
      
      const newWallets = newWalletIds.map(id => walletMap.get(id))
        .filter(wallet => wallet.transactions.length > 0)
        .sort((a, b) => {
          const aFirstTx = a.transactions.reduce((earliest, tx) => 
            new Date(tx.timestamp) < new Date(earliest.timestamp) ? tx : earliest, a.transactions[0]);
          const bFirstTx = b.transactions.reduce((earliest, tx) => 
            new Date(tx.timestamp) < new Date(earliest.timestamp) ? tx : earliest, b.transactions[0]);
          return new Date(aFirstTx.timestamp).getTime() - new Date(bFirstTx.timestamp).getTime();
        });
      
      wallets = [...wallets, ...newWallets];
      
      // Check if enough different wallets made a transaction
      const totalUniqueWallets = wallets.length;
      
      if (totalUniqueWallets >= minWallets) {
        const isUpdate = existingConfluence.wallets.length > 0;
        
        // Count real transactions (not from metadata)
        const nonMetadataWallets = wallets.filter(w => !w.isFromMetadata);
        
        // Determine the primary transaction type based on most recent activity
        // or the type with the most transactions
        const buyWallets = wallets.filter(w => w.buyBaseAmount > 0).length;
        const sellWallets = wallets.filter(w => w.sellBaseAmount > 0).length;
        const primaryType = buyWallets >= sellWallets ? 'buy' : 'sell';
        
        // Create the confluence object
        const confluence = {
          type: primaryType, // Primary type for the message emoji
          coin,
          coinAddress,
          wallets,
          count: totalUniqueWallets,
          nonMetadataCount: nonMetadataWallets.length,
          totalAmount: wallets.reduce((sum, w) => sum + w.amount, 0),
          totalUsdValue: wallets.reduce((sum, w) => sum + (w.usdValue || 0), 0),
          totalBaseAmount: wallets.reduce((sum, w) => sum + (w.baseAmount || 0), 0),
          avgMarketCap: wallets.reduce((sum, w) => sum + (w.marketCap || 0), 0) / wallets.length,
          timestamp: new Date(),
          groupId,
          isUpdate,
          buyCount: buyWallets,
          sellCount: sellWallets,
          // Add 48h window flag
          is48hWindow: nonMetadataWallets.length < minWallets && totalUniqueWallets >= minWallets
        };
        
        // Save this confluence for future reference
        await cacheManager.detectedConfluences.set(confluenceKey, confluence);
        
        // Only send updates if something has changed
        if (isUpdate) {
          // Only add to results if at least one wallet was updated
          if (wallets.some(w => w.isUpdated)) {
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
   * Check for confluences
   * @param {string} groupId - Group ID
   * @returns {Promise<Array>} - List of detected confluences
   */
  async checkConfluences(groupId = 'default') {
    // Start measuring performance
    const perfTimer = performanceMonitor.startTimer();
    
    try {
      const confluences = [];
      const detectedTokens = new Map(); // Map to track tokens by their address or name
      const keys = await cacheManager.transactionsCache.keys();
      
      // Filter keys for this group
      const groupKeys = keys.filter(key => key.startsWith(`${groupId}_`));
      
      // Debug log for monitoring
      if (groupKeys.length > 100) {
        logger.warn(`Large number of cache keys for group ${groupId}: ${groupKeys.length} keys`);
      }
      
      // Optimization: retrieve all transactions at once
      const keyTransactionMap = {};
      const getPromises = [];
      
      // Start measuring cache retrieval performance
      const cacheTimer = performanceMonitor.startTimer();
      
      for (const key of groupKeys) {
        getPromises.push(
          cacheManager.transactionsCache.get(key)
            .then(transactions => {
              if (transactions) {
                keyTransactionMap[key] = transactions;
              }
            })
        );
      }
      
      // Wait for all transactions to be retrieved
      await Promise.all(getPromises);
      
      // End measuring cache performance
      performanceMonitor.endTimer(cacheTimer, 'transactionProcessing', `cache_retrieval_${groupId}`);
      
      // First pass: identify all tokens and their information from cache
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
        
        // Skip if no recent transactions
        const hasNewTransactions = transactions.some(tx => 
          new Date(tx.timestamp) > startupTime
        );
        
        // Get coin name from transactions if missing
        if (!coin && coinAddress && transactions.length > 0) {
          coin = transactions[0].coin;
        }
        
        // Create a unified token identifier (prefer address, fallback to name)
        const tokenId = coinAddress && coinAddress.length > 0 ? coinAddress : coin;
        
        // Store token info
        if (!detectedTokens.has(tokenId)) {
          detectedTokens.set(tokenId, {
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
        const tokenInfo = detectedTokens.get(tokenId);
        if (type === 'buy') {
          tokenInfo.buyTransactions.push(...transactions);
        } else if (type === 'sell') {
          tokenInfo.sellTransactions.push(...transactions);
        }
      }
      
      // Add older transactions metadata to the detected tokens
      if (this.olderTransactionsMetadata) {
        for (const [key, metadata] of Object.entries(this.olderTransactionsMetadata)) {
          // Only process keys for this group
          if (!key.startsWith(`${groupId}_`)) continue;
          
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
          
          if (!tokenId) continue;
          
          // Get or create token info
          if (!detectedTokens.has(tokenId)) {
            detectedTokens.set(tokenId, {
              coin: metadata.coin,
              coinAddress: metadata.coinAddress,
              buyTransactions: [],
              sellTransactions: [],
              groupId: groupId,
              olderBuyData: null,
              olderSellData: null
            });
          }
          
          const tokenInfo = detectedTokens.get(tokenId);
          
          // Add older transaction metadata
          if (type === 'buy') {
            tokenInfo.olderBuyData = metadata;
          } else if (type === 'sell') {
            tokenInfo.olderSellData = metadata;
          }
        }
      }
      
      // Second pass: process each token
      const confluencePromises = [];
      
      for (const [tokenId, tokenInfo] of detectedTokens.entries()) {
        confluencePromises.push(
          this.processTokenConfluence(tokenId, tokenInfo, confluences)
        );
      }
      
      // Wait for all tokens to be processed
      await Promise.all(confluencePromises);
      
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