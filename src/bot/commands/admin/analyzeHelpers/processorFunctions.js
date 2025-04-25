const logger = require('../../../../utils/logger');

/**
 * Process confluences and adjust them based on minimum wallets
 * @param {Array} allConfluences - All confluences from the database
 * @param {number} minWallets - Minimum wallets required for analysis
 * @returns {Array} - Adjusted confluences
 */
function processAndFilterConfluences(allConfluences, minWallets) {
  const adjustedConfluences = [];
  
  for (const conf of allConfluences) {
    if (conf.totalUniqueWallets >= minWallets) {
      // Sort wallets by timestamp to identify the Nth buy
      const sortedWallets = [...conf.additionalWallets];
      
      if (conf.firstWallet) sortedWallets.unshift(conf.firstWallet);
      if (conf.secondWallet) sortedWallets.unshift(conf.secondWallet);
      
      sortedWallets.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      
      // If there are enough wallets for the required threshold
      if (sortedWallets.length >= minWallets) {
        // Take the timestamp and marketCap of the Nth wallet (index minWallets-1)
        const targetWallet = sortedWallets[minWallets-1];
        
        // Create a modified copy of the confluence
        const adjustedConf = {
          ...conf,
          detectionTimestamp: targetWallet.timestamp,
          detectionMarketCap: targetWallet.marketCap || conf.detectionMarketCap,
          minWalletsUsed: minWallets
        };
        
        adjustedConfluences.push(adjustedConf);
      }
    }
  }
  
  return adjustedConfluences;
}

/**
 * Filter tokens based on address validity
 * @param {Array} confluences - Adjusted confluences
 * @returns {Object} - Object containing filtered real tokens and counts
 */
function filterValidTokens(confluences) {
  // Filter to only tokens with valid addresses
  const confluencesWithAddresses = confluences.filter(conf => 
    conf.tokenAddress && conf.tokenAddress.trim().length > 0
  );
  
  // Filter out simulated tokens
  const realTokens = confluencesWithAddresses.filter(conf => 
    !conf.tokenAddress.startsWith('SIM') && conf.tokenAddress.length >= 30
  );
  
  return {
    realTokens,
    withAddressCount: confluencesWithAddresses.length,
    realTokenCount: realTokens.length
  };
}

/**
 * Prepare token data for processing by Birdeye API
 * @param {Array} realTokens - Filtered list of real tokens
 * @param {Object} analysisOptions - Options for analysis
 * @returns {Array} - Prepared token data
 */
function prepareTokensData(realTokens, analysisOptions) {
  return realTokens.map(conf => ({
    tokenAddress: conf.tokenAddress,
    tokenName: conf.tokenName,
    detectionTime: new Date(conf.detectionTimestamp), // Timestamp of the Nth wallet
    initialMarketCap: conf.detectionMarketCap,        // MarketCap of the Nth wallet
    options: analysisOptions,
    minWalletsUsed: conf.minWalletsUsed // For reference
  }));
}

/**
 * Process tokens in batches to avoid API limits
 * @param {Array} tokensData - Data prepared for API 
 * @param {number} batchSize - Size of batches
 * @param {Function} processBatch - Function to process a batch
 * @param {Function} updateProgress - Function to update progress
 * @returns {Promise<Object>} - Results and failed tokens
 */
async function processBatches(tokensData, batchSize, processBatch, updateProgress) {
  const totalBatches = Math.ceil(tokensData.length / batchSize);
  let allResults = [];
  let failedTokens = [];
  
  for (let i = 0; i < totalBatches; i++) {
    const batchStart = i * batchSize;
    const batchEnd = Math.min(batchStart + batchSize, tokensData.length);
    const batch = tokensData.slice(batchStart, batchEnd);
    
    // Update progress
    if (updateProgress) {
      await updateProgress(i, totalBatches, batchStart, batchEnd, tokensData.length, allResults.length);
    }
    
    // Process this batch
    try {
      const batchResults = await processBatch(batch);
      
      // Log tokens that failed to return valid data
      const processedTokens = new Set(batchResults.map(r => r.tokenName));
      batch.forEach(token => {
        if (!processedTokens.has(token.tokenName)) {
          logger.warn(`Failed to get ATH data for token ${token.tokenName} (${token.tokenAddress})`);
          failedTokens.push({
            name: token.tokenName,
            address: token.tokenAddress,
            reason: "No data returned from API"
          });
        }
      });
      
      // Add valid results
      allResults = allResults.concat(batchResults);
    } catch (error) {
      logger.error(`Error processing batch ${i+1}: ${error.message}`);
      batch.forEach(token => {
        failedTokens.push({
          name: token.tokenName,
          address: token.tokenAddress,
          reason: `Batch error: ${error.message}`
        });
      });
    }
    
    // If we're not at the last batch, add a longer delay to avoid API throttling
    if (i < totalBatches - 1) {
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  
  return { allResults, failedTokens };
}

module.exports = {
  processAndFilterConfluences,
  filterValidTokens,
  prepareTokensData,
  processBatches
};