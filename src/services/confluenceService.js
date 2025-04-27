// src/services/confluenceService.js
const CacheService = require('./cacheService');
const config = require('../config/config');
const logger = require('../utils/logger');
const transactionService = require('../db/services/transactionService');
const performanceMonitor = require('../utils/performanceMonitor');

/**
 * Service to detect buy and sell confluences
 */

const startupTime = new Date();

const confluenceService = {
  // Cache to store recent transactions for fast access
  transactionsCache: new CacheService({ 
    stdTTL: config.confluence.windowMinutes * 60,
    prefix: config.redis.transactionsCachePrefix
  }),
  
  // Cache to store already detected confluences to avoid duplicates
  detectedConfluences: new CacheService({ 
    stdTTL: config.confluence.windowMinutes * 60,
    prefix: config.redis.confluencesCachePrefix
  }),
  
  /**
   * Initialize the confluence service
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      // Initialize cache services
      await this.transactionsCache.initialize();
      await this.detectedConfluences.initialize();
      
      // Load 48h of transactions from MongoDB (as configured in .env)
      const fullWindowMinutes = config.confluence.windowMinutes; // 2880 minutes (48h)
      const transactions = await transactionService.loadRecentTransactions(fullWindowMinutes);
      
      // Optimize memory usage - only keep the most recent 12h in cache
      // for frequent operations, but still use all 48h for confluence detection
      const cacheWindowHours = 12;
      const cacheWindowMs = cacheWindowHours * 60 * 60 * 1000;
      const recentTimestamp = new Date(Date.now() - cacheWindowMs);
      
      // Split transactions between recent (for cache) and older (for analysis only)
      const recentTransactions = [];
      const olderTransactions = [];
      
      for (const tx of transactions) {
        if (new Date(tx.timestamp) >= recentTimestamp) {
          recentTransactions.push(tx);
        } else {
          olderTransactions.push(tx);
        }
      }
      
      logger.info(`Loaded ${transactions.length} transactions (${recentTransactions.length} recent for cache, ${olderTransactions.length} older for analysis)`);
      
      // Group recent transactions for cache storage
      const grouped = {};
      
      for (const tx of recentTransactions) {
        // Make sure type is valid
        if (!tx.type) {
          tx.type = tx.baseAmount > 0 ? 'buy' : 'sell';
          logger.debug(`Setting default type ${tx.type} for transaction from wallet ${tx.walletName}`);
        }
        
        // Determine the appropriate cache key - prioritize address over name
        let key;
        if (tx.coinAddress && tx.coinAddress.length > 0) {
          key = `${tx.groupId}_${tx.type}_addr_${tx.coinAddress}`;
        } else {
          key = `${tx.groupId}_${tx.type}_name_${tx.coin}`;
        }
        
        if (!grouped[key]) {
          grouped[key] = [];
        }
        
        // Include all important fields
        grouped[key].push({
          walletName: tx.walletName,
          walletAddress: tx.walletAddress, // Include wallet address
          coin: tx.coin,
          coinAddress: tx.coinAddress,
          amount: tx.amount,
          usdValue: tx.usdValue,
          timestamp: tx.timestamp,
          marketCap: tx.marketCap || 0,
          type: tx.type,                // Preserve transaction type
          baseAmount: tx.baseAmount || 0,  // Preserve base amount
          baseSymbol: tx.baseSymbol || ''  // Preserve base symbol
        });
      }
      
      // Populate cache with grouped transactions using batch operations
      const batchPromises = [];
      for (const [key, txList] of Object.entries(grouped)) {
        batchPromises.push(this.transactionsCache.set(key, txList));
      }
      
      // Wait for all cache operations to complete
      await Promise.all(batchPromises);
      
      // Store metadata about older transactions to support 48h confluence detection
      this.olderTransactionsMetadata = this.groupOlderTransactions(olderTransactions);
      
      logger.info(`Confluence service initialized with ${Object.keys(grouped).length} transaction groups in cache and ${Object.keys(this.olderTransactionsMetadata).length} older transaction groups metadata`);
    } catch (error) {
      logger.error(`Error initializing confluence service: ${error.message}`);
    }
  },
  
  /**
   * Group older transactions for metadata tracking
   * This helps support 48h confluence detection without keeping all data in memory
   * @param {Array} transactions - Older transactions
   * @returns {Object} Grouped metadata by token/group
   */
  groupOlderTransactions(transactions) {
    const metadata = {};
    
    for (const tx of transactions) {
      // Make sure type is valid
      if (!tx.type) {
        tx.type = tx.baseAmount > 0 ? 'buy' : 'sell';
      }
      
      // Determine key (same pattern as cache keys)
      let key;
      if (tx.coinAddress && tx.coinAddress.length > 0) {
        key = `${tx.groupId}_${tx.type}_addr_${tx.coinAddress}`;
      } else {
        key = `${tx.groupId}_${tx.type}_name_${tx.coin}`;
      }
      
      if (!metadata[key]) {
        metadata[key] = {
          groupId: tx.groupId,
          type: tx.type,
          coin: tx.coin,
          coinAddress: tx.coinAddress,
          wallets: new Set(),
          oldestTimestamp: tx.timestamp,
          newestTimestamp: tx.timestamp,
          count: 0,
          totalAmount: 0,
          totalBaseAmount: 0
        };
      }
      
      // Update metadata stats
      const entry = metadata[key];
      entry.wallets.add(tx.walletName);
      entry.count++;
      entry.totalAmount += tx.amount || 0;
      entry.totalBaseAmount += tx.baseAmount || 0;
      
      // Update timestamp range
      if (new Date(tx.timestamp) < new Date(entry.oldestTimestamp)) {
        entry.oldestTimestamp = tx.timestamp;
      }
      if (new Date(tx.timestamp) > new Date(entry.newestTimestamp)) {
        entry.newestTimestamp = tx.timestamp;
      }
    }
    
    // Convert Sets to arrays for easier handling
    for (const key in metadata) {
      metadata[key].wallets = Array.from(metadata[key].wallets);
    }
    
    return metadata;
  },

/**
 * Check if a transaction is a duplicate (same wallet, same token, similar time)
 * @param {Array} existingTransactions - Existing transactions in the group
 * @param {Transaction} newTransaction - New transaction to check
 * @returns {boolean} - True if it's a duplicate
 */
isDuplicateTransaction(existingTransactions, newTransaction) {
  // Time window for considering transactions as duplicates (e.g., 30 seconds)
  const TIME_WINDOW = 30 * 1000; // 30 seconds in milliseconds
  
  return existingTransactions.some(existing => {
    // Check if it's from the same wallet (using address if available, otherwise name)
    const sameWallet = (existing.walletAddress && newTransaction.walletAddress) 
      ? existing.walletAddress === newTransaction.walletAddress
      : existing.walletName === newTransaction.walletName;
    
    // Check if it's the same token
    const sameToken = existing.coinAddress === newTransaction.coinAddress || 
                     existing.coin === newTransaction.coin;
    
    // Check if it's a similar amount (allowing for small differences due to fees)
    const amountDifference = Math.abs(existing.baseAmount - newTransaction.baseAmount);
    const similarAmount = existing.baseAmount === 0 
      ? amountDifference < 0.01 
      : amountDifference / existing.baseAmount < 0.01; // Within 1%
    
    // Check if it's within the time window
    const timeDifference = Math.abs(new Date(existing.timestamp) - new Date(newTransaction.timestamp));
    const withinTimeWindow = timeDifference < TIME_WINDOW;
    
    return sameWallet && sameToken && similarAmount && withinTimeWindow;
  });
},
  
 /**
 * Add a transaction with duplicate checking
 * @param {Transaction} transaction - Transaction to add
 * @param {string} groupId - Group ID
 * @returns {Promise<boolean>} Success status
 */
async addTransaction(transaction, groupId) {
  try {
    // Check for invalid transactions
    if (!transaction.type || !['buy', 'sell'].includes(transaction.type)) {
      logger.warn(`addTransaction: Invalid transaction type '${transaction.type}' - skipping`);
      return false;
    }
    
    // Generate cache key
    let key;
    if (transaction.coinAddress && transaction.coinAddress.trim().length > 0 
        && transaction.coinAddress !== 'unknown' 
        && transaction.coinAddress !== 'undefined') {
      key = `${groupId}_${transaction.type}_addr_${transaction.coinAddress}`;
    } else {
      key = `${groupId}_${transaction.type}_name_${transaction.coin}`;
    }
    
    logger.debug(`Using ${transaction.coinAddress ? 'address' : 'name'}-based key: ${key} for token ${transaction.coin || 'UNKNOWN'} (address: ${transaction.coinAddress || 'none'})`);
    
    // Get existing transactions
    let transactions = await this.transactionsCache.get(key) || [];
    
    // Check for duplicates
    if (this.isDuplicateTransaction(transactions, transaction)) {
      logger.info(`Duplicate transaction detected for wallet ${transaction.walletName} - skipping`);
      return false;
    }
    
    // Store in MongoDB first
    const mongoResult = await transactionService.storeTransaction(transaction, groupId);
    if (!mongoResult) {
      logger.error(`Failed to store transaction in MongoDB for group ${groupId}`);
      return false;
    }
    
    // Add to transaction array
    transactions.push(transaction);
    
    // Store in cache
    await this.transactionsCache.set(key, transactions);
    
    // Keep metadata synchronized
    const metadataKey = `meta_${key}`;
    let metadata = await this.transactionsCache.get(metadataKey) || {};
    metadata.lastUpdated = new Date();
    metadata.tokenAddress = transaction.coinAddress;
    metadata.tokenSymbol = transaction.coin;
    metadata.transactionCount = transactions.length;
    
    await this.transactionsCache.set(metadataKey, metadata);
    
    logger.info(`Transaction added for group ${groupId}: ${transaction.type} ${transaction.amount} ${transaction.coin || 'UNKNOWN'} by ${transaction.walletName}, key: ${key}`);
    return true;
  } catch (error) {
    logger.error(`Error in confluenceService.addTransaction: ${error.message}`);
    return false;
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
      const keys = await this.transactionsCache.keys();
      
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
          this.transactionsCache.get(key)
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
  },
  
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
      const minWallets = await this.getMinWalletsForGroup(groupId);
      let additionalTransactions = [];
      
      // If we have few cached transactions but lots of older ones, we might need to load more data
      if (allTransactions.length === 0 || (totalWalletCount >= minWallets && allTransactions.length < 10)) {
        //logger.debug(`Fetching additional transactions from MongoDB for token ${coin || coinAddress} in group ${groupId}`);
        
        // Fetch from MongoDB to fill in details not in cache
        try {
          if (coinAddress) {
            // Try loading by address first
            additionalTransactions = await transactionService.getRecentTransactionsByAddress(
              groupId, coinAddress, config.confluence.windowMinutes
            );
          } else if (coin) {
            // Fallback to loading by name
            additionalTransactions = await transactionService.getRecentTransactionsByCoin(
              groupId, coin, config.confluence.windowMinutes
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
      
      // Add better logging for token identification
      const buyCount = combinedTransactions.filter(tx => tx.type === 'buy').length;
      const sellCount = combinedTransactions.filter(tx => tx.type === 'sell').length;
      //logger.debug(`Processing token ${coin || 'UNKNOWN'} (address: ${coinAddress || 'none'}): ${buyCount} buy txs, ${sellCount} sell txs, ${totalWalletCount} unique wallets`);
      
      // Skip if still no transactions
      if (combinedTransactions.length === 0) return;
      
      // Generate a unique key for this token's confluence
      const confluenceKey = coinAddress && coinAddress.length > 0 
        ? `${groupId}_addr_${coinAddress}` // Remove transaction type from key
        : `${groupId}_name_${coin}`;

      //logger.debug(`Using confluence key: ${confluenceKey} based on ${coinAddress ? 'address' : 'name'}`);
        
      // Get existing confluence for this token
      const existingConfluence = await this.detectedConfluences.get(confluenceKey) || { wallets: [] };
      
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
        await this.detectedConfluences.set(confluenceKey, confluence);
        
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
   * Get minimum wallets setting for a group
   * @param {string} groupId - Group ID
   * @returns {Promise<number>} Minimum wallets setting
   */
  async getMinWalletsForGroup(groupId) {
    // This could be extended to get group-specific settings from the database
    // Dans une version future, vous pourriez récupérer cette valeur depuis MongoDB
    return config.confluence.minWallets;
  },

  /**
   * Estimate the used cache size
   * @returns {Promise<Object>} Cache size estimation
   */
  async estimateCacheSize() {
    // Utiliser la méthode estimateSize du cacheService
    return this.transactionsCache.estimateSize();
  },

 
  /**
   * Amélioration de la fonction findTransactionsForToken pour inclure plus d'informations sur l'adresse
   * @param {string} tokenSymbolOrAddress - Symbol or address to search for
   * @returns {Promise<void>}
   */
  async findTransactionsForToken(tokenSymbolOrAddress) {
    const keys = await this.transactionsCache.keys();
    logger.debug(`--- LOOKING FOR TOKEN: ${tokenSymbolOrAddress} ---`);
    
    let found = false;
    const searchPromises = [];
    
    for (const key of keys) {
      // Check both address-based and name-based keys
      if (key.includes(`_addr_${tokenSymbolOrAddress}`) || 
          key.includes(`_name_${tokenSymbolOrAddress}`)) {
        
        searchPromises.push(
          this.transactionsCache.get(key).then(transactions => {
            if (!transactions) return;
            
            found = true;
            logger.debug(`Found in key: ${key}`);
            logger.debug(`  Transactions: ${transactions.length}`);
            
            // Add details about the first transaction to see full token info
            if (transactions.length > 0) {
              const firstTx = transactions[0];
              logger.debug(`  Token details: Name=${firstTx.coin || 'UNKNOWN'}, Address=${firstTx.coinAddress || 'none'}`);
            }
            
            for (const tx of transactions) {
              logger.debug(`  - Wallet: ${tx.walletName}, Amount: ${tx.amount}, Type: ${tx.type}, Base: ${tx.baseAmount} ${tx.baseSymbol}, Time: ${new Date(tx.timestamp).toISOString()}`);
            }
          })
        );
      }
    }
    
    // Attendre que toutes les recherches soient terminées
    await Promise.all(searchPromises);
    
    if (!found) {
      logger.debug(`No transactions found for token: ${tokenSymbolOrAddress}`);
    }
    
    logger.debug(`--- END TOKEN SEARCH ---`);
  },

  /**
   * Dump the entire transactions cache for debugging
   * @returns {Promise<void>}
   */
  async dumpTransactionsCache() {
    const keys = await this.transactionsCache.keys();
    logger.debug(`--- TRANSACTION CACHE DUMP ---`);
    logger.debug(`Total keys in cache: ${keys.length}`);
    
    const dumpPromises = [];
    
    for (const key of keys) {
      dumpPromises.push(
        this.transactionsCache.get(key).then(transactions => {
          if (!transactions) return;
          
          logger.debug(`Key: ${key}`);
          logger.debug(`  Transactions: ${transactions.length}`);
          
          const wallets = new Set();
          for (const tx of transactions) {
            wallets.add(tx.walletName);
          }
          
          logger.debug(`  Unique wallets: ${wallets.size}`);
          logger.debug(`  Wallets: ${Array.from(wallets).join(', ')}`);
        })
      );
    }
    
    // Attendre que tous les dumps soient terminés
    await Promise.all(dumpPromises);
    
    logger.debug(`--- END TRANSACTION CACHE DUMP ---`);
  },
  
  /**
   * Clean transactions that are too old
   * @returns {Promise<void>}
   */
  async cleanOldTransactions() {
    try {
      const keys = await this.transactionsCache.keys();
      const now = new Date();
      let totalRemoved = 0;
      let totalKept = 0;
      
      const cleanupPromises = [];
      
      for (const key of keys) {
        cleanupPromises.push(
          this.transactionsCache.get(key).then(async transactions => {
            if (!transactions) return;
            
            const originalCount = transactions.length;
            
            // Filter to keep only transactions within the time window
            const filteredTransactions = transactions.filter(tx => {
              const diffMs = now - new Date(tx.timestamp);
              const diffMinutes = diffMs / 60000;
              return diffMinutes <= config.confluence.windowMinutes;
            });
            
            const removed = originalCount - filteredTransactions.length;
            totalRemoved += removed;
            totalKept += filteredTransactions.length;
            
            if (filteredTransactions.length > 0) {
              await this.transactionsCache.set(key, filteredTransactions);
              if (removed > 0) {
                logger.debug(`Cleaned ${removed} old transactions for ${key}, ${filteredTransactions.length} remain`);
              }
            } else {
              await this.transactionsCache.del(key);
              logger.debug(`Removed empty key ${key} from cache`);
            }
          })
        );
      }
      
      // Attendre que tous les nettoyages soient terminés
      await Promise.all(cleanupPromises);

      // Check the total size and clean if necessary
      const cacheStats = await this.estimateCacheSize();
      
      if (cacheStats.estimatedSizeMB > 100) {
        logger.warn(`Cache size exceeds threshold (${cacheStats.estimatedSizeMB.toFixed(2)}MB), performing additional cleanup`);
        
        // Récupérer à nouveau les clés (après le nettoyage précédent)
        const updatedKeys = await this.transactionsCache.keys();
        
        // Récupérer toutes les transactions pour les trier
        const keyTransactions = {};
        const fetchPromises = [];
        
        for (const key of updatedKeys) {
          fetchPromises.push(
            this.transactionsCache.get(key).then(transactions => {
              if (transactions && transactions.length > 0) {
                keyTransactions[key] = transactions;
              }
            })
          );
        }
        
        await Promise.all(fetchPromises);
        
        // Trier les clés par date
        const sortedKeys = Object.keys(keyTransactions).sort((a, b) => {
          const txA = keyTransactions[a];
          const txB = keyTransactions[b];
          
          if (!txA || txA.length === 0) return 1;
          if (!txB || txB.length === 0) return -1;
          
          const latestA = Math.max(...txA.map(tx => new Date(tx.timestamp).getTime()));
          const latestB = Math.max(...txB.map(tx => new Date(tx.timestamp).getTime()));
          
          return latestB - latestA; 
        });
        
        // Delete the 30% oldest transaction groups
        const keysToRemove = sortedKeys.slice(Math.floor(sortedKeys.length * 0.7));
        const removePromises = [];
        
        for (const key of keysToRemove) {
          removePromises.push(this.transactionsCache.del(key));
        }
        
        await Promise.all(removePromises);
        
        logger.info(`Emergency cleanup completed: removed ${keysToRemove.length} transaction groups`);
      }
      
      if (totalRemoved > 0) {
        logger.info(`Cleaned ${totalRemoved} old transactions, ${totalKept} remain in cache`);
      }
    } catch (error) {
      logger.error('Error cleaning old transactions:', error);
    }
  }
};

module.exports = confluenceService;