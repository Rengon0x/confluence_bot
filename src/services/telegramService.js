// src/services/telegramService.js
const logger = require('../utils/logger');

/**
 * Service to handle Telegram interactions
 */
const telegramMessageService = {
  /**
   * Format a confluence message for Telegram
   * @param {Object} confluence - Object containing confluence data
   * @returns {string} - Formatted HTML message for Telegram
   */
  formatConfluenceMessage(confluence) {
    try {
      // The primary emoji is determined by the transaction type of the confluence
      const primaryEmoji = confluence.type === 'buy' ? '🟢' : '🔴';
      const isUpdate = confluence.isUpdate ? 'UPDATED' : 'DETECTED';
      
      // Format token identifier - use token name if available, otherwise use address
      let tokenIdentifier;
      if (confluence.coin && confluence.coin.trim().length > 0 && 
          confluence.coin.toUpperCase() !== 'UNKNOWN') {
        tokenIdentifier = `$${confluence.coin}`;
      } else if (confluence.coinAddress && confluence.coinAddress.trim().length > 0) {
        // Use token address with code formatting to make it copiable
        tokenIdentifier = `<code>${confluence.coinAddress}</code>`;
      } else {
        tokenIdentifier = '$UNKNOWN';
      }
      
      let message = `${primaryEmoji} CONFLUENCE ${isUpdate} FOR ${tokenIdentifier}\n\n`;
      
      // Create two arrays for wallets - preserving the original if wallet has both buy and sell
      const displayWallets = [];
      const processedWallets = new Set();
      
       // Process each wallet to determine how it should be displayed
    confluence.wallets.forEach(wallet => {
      // Identifiant unique pour ce portefeuille (adresse ou nom si pas d'adresse)
      const walletId = wallet.walletAddress || wallet.walletName;
      
      // Si ce portefeuille a déjà été traité, passez au suivant
      if (processedWallets.has(walletId)) {
        return;
      }
      processedWallets.add(walletId);
      
      // Rassembler toutes les transactions de ce portefeuille
      // en parcourant tous les wallets pour trouver celles du même portefeuille
      const allTransactions = [];
      confluence.wallets.forEach(w => {
        const wId = w.walletAddress || w.walletName;
        if (wId === walletId && w.transactions) {
          allTransactions.push(...w.transactions);
        }
      });
      
      // Séparer les transactions d'achat et de vente
      const buyTransactions = allTransactions.filter(tx => tx.type === 'buy');
      const sellTransactions = allTransactions.filter(tx => tx.type === 'sell');
      
      // Le reste du code reste identique...
      if (buyTransactions.length > 0) {
        // Create a buy display for this wallet
        const buyDisplay = {
          walletName: wallet.walletName,
          baseAmount: buyTransactions.reduce((sum, tx) => sum + (tx.baseAmount || 0), 0),
          baseSymbol: buyTransactions[0].baseSymbol || 'SOL',
          marketCap: calculateWeightedAverage(buyTransactions, 'marketCap', 'baseAmount'),
          type: 'buy',
          isUpdated: wallet.isUpdated && wallet.type === 'buy' && 
                     isRecentlyUpdated(wallet, buyTransactions)
        };
        displayWallets.push(buyDisplay);
      }
      
      if (sellTransactions.length > 0) {
        // Also create a sell display for this wallet if it has sell transactions
        const sellDisplay = {
          walletName: wallet.walletName,
          baseAmount: sellTransactions.reduce((sum, tx) => sum + (tx.baseAmount || 0), 0),
          baseSymbol: sellTransactions[0].baseSymbol || 'SOL', 
          marketCap: calculateWeightedAverage(sellTransactions, 'marketCap', 'baseAmount'),
          type: 'sell',
          isUpdated: wallet.isUpdated && wallet.type === 'sell' &&
                     isRecentlyUpdated(wallet, sellTransactions)
        };
        displayWallets.push(sellDisplay);
      }
    });
      
      // We want to preserve both buy and sell displays for the same wallet
      // So we'll deduplicate by wallet + type instead of just wallet
      const walletsByTypeAndName = {};
      
      displayWallets.forEach(wallet => {
        // Create a unique key for each wallet+type combination
        const walletKey = `${wallet.walletName}_${wallet.type}`;
        
        // If we haven't seen this wallet+type yet, add it
        if (!walletsByTypeAndName[walletKey]) {
          walletsByTypeAndName[walletKey] = wallet;
        }
        // If this is a newer transaction from the same wallet+type, replace the previous one
        else if (wallet.isUpdated && !walletsByTypeAndName[walletKey].isUpdated) {
          walletsByTypeAndName[walletKey] = wallet;
        }
      });
      
      // Convert back to arrays for buy/sell grouping
      const uniqueWalletDisplays = Object.values(walletsByTypeAndName);
      const buyDisplays = uniqueWalletDisplays.filter(w => w.type === 'buy');
      const sellDisplays = uniqueWalletDisplays.filter(w => w.type === 'sell');
      
      // Format wallets for display
      const formatWallet = wallet => {
        // Determine if this wallet line was updated
        const updateEmoji = wallet.isUpdated ? '🔄 ' : '';
        
        // Use the wallet's transaction type for the emoji (buy or sell)
        const walletEmoji = wallet.type === 'buy' ? '🟢' : '🔴';
        
        // Format marketCap
        let formattedMC = wallet.marketCap;
        if (formattedMC >= 1000000000) {
          formattedMC = `${(formattedMC / 1000000000).toFixed(1)}B`;
        } else if (formattedMC >= 1000000) {
          formattedMC = `${(formattedMC / 1000000).toFixed(1)}M`;
        } else if (formattedMC >= 1000) {
          formattedMC = `${(formattedMC / 1000).toFixed(1)}k`;
        } else {
          formattedMC = `${formattedMC.toFixed(2)}`;
        }
        
        // Get the wallet name without the # prefix if it exists
        const displayName = wallet.walletName.replace(/^#/, '');
        
        // Format base amount (SOL/ETH)
        const baseAmount = wallet.baseAmount !== undefined && wallet.baseAmount > 0 ? 
          wallet.baseAmount.toFixed(2) : 
          "0.00";
          
        // Get base symbol, default to SOL if not specified
        const baseSymbol = wallet.baseSymbol || "SOL";
        
        return `${updateEmoji}${walletEmoji} ${displayName}: ${baseAmount}${baseSymbol}@${formattedMC} mcap`;
      };
      
      // Add buy wallets to message - keep original order for buys
      if (buyDisplays.length > 0) {
        buyDisplays.forEach(wallet => {
          message += formatWallet(wallet) + '\n';
        });
      }
      
      // Add a separator between buys and sells if both exist
      if (buyDisplays.length > 0 && sellDisplays.length > 0) {
        message += '\n';
      }
      
      // Add sell wallets to message
      if (sellDisplays.length > 0) {
        sellDisplays.forEach(wallet => {
          message += formatWallet(wallet) + '\n';
        });
      }
      
      return message;
    } catch (error) {
      logger.error('Error formatting confluence message:', error);
      return `Confluence detected for ${confluence.coin || confluence.coinAddress || 'UNKNOWN'}: ${confluence.wallets.length} wallets`;
    }
  }
};

/**
 * Calculate a weighted average of a field based on another field
 * @param {Array} transactions - Array of transaction objects
 * @param {string} field - Field to average
 * @param {string} weightField - Field to use as weight
 * @returns {number} - Weighted average
 */
function calculateWeightedAverage(transactions, field, weightField) {
  if (!transactions || transactions.length === 0) return 0;
  
  let totalWeight = 0;
  let weightedSum = 0;
  
  for (const tx of transactions) {
    const value = tx[field] || 0;
    const weight = tx[weightField] || 0;
    
    if (weight > 0) {
      weightedSum += value * weight;
      totalWeight += weight;
    }
  }
  
  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

/**
 * Check if a wallet was recently updated (based on the most recent transaction)
 * @param {Object} wallet - Wallet object
 * @param {Array} transactions - Transactions for this wallet of specific type
 * @returns {boolean} - True if wallet was recently updated
 */
function isRecentlyUpdated(wallet, transactions) {
  if (!transactions || transactions.length === 0) return false;
  
  // Check if the most recent transaction is very new (last 30 seconds)
  const mostRecentTx = transactions.reduce((latest, tx) => {
    return new Date(tx.timestamp) > new Date(latest.timestamp) ? tx : latest;
  }, transactions[0]);
  
  const now = new Date();
  const txTime = new Date(mostRecentTx.timestamp);
  const diffSeconds = (now - txTime) / 1000;
  
  // If the most recent transaction is within the last 30 seconds, 
  // consider it a recent update that should get the update emoji
  return diffSeconds < 30;
}

module.exports = telegramMessageService;