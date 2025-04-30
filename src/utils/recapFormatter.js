// src/utils/recapFormatter.js
const { sendLongMessage } = require('../bot/utils/messageUtils');

/**
 * Format a timeframe in hours to a human-readable string
 * @param {number} hours - Timeframe in hours
 * @returns {string} - Formatted timeframe
 */
function formatTimeframe(hours) {
  if (hours < 1) {
    return `${Math.round(hours * 60)}m`;
  } else if (hours < 24) {
    return `${hours}h`;
  } else {
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
  }
}

/**
 * Get appropriate emoji for performance level
 * @param {number} percentage - Performance percentage
 * @returns {string} - Emoji
 */
function getPerformanceEmoji(percentage) {
  if (percentage >= 500) {
    return '💎'; // Diamond for 500%+ gains
  } else if (percentage >= 200) {
    return '🔥'; // Fire for 200%+ gains
  } else if (percentage >= 100) {
    return '🚀'; // Rocket for 100%+ gains
  } else if (percentage >= 50) {
    return '📈'; // Chart up for 50%+ gains
  } else if (percentage > 0) {
    return '➡️'; // Sideways for 0-50% gains
  } else if (percentage === 0) {
    return '⏹️'; // No change
  } else if (percentage >= -50) {
    return '↘️'; // Down-right for small losses
  } else {
    return '📉'; // Chart down for big losses
  }
}

/**
 * Format market cap for display
 * @param {number} marketCap - Market cap value
 * @returns {string} - Formatted market cap
 */
function formatMarketCap(marketCap) {
  if (!marketCap || isNaN(marketCap)) return "?";
  
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

/**
 * Format the recap message
 * @param {Object} data - Performance data
 * @param {number} timeframeHours - Timeframe in hours
 * @returns {string} - Formatted message
 */
function formatRecapMessage(data, timeframeHours) {
  if (!data || !data.confluences || data.confluences.length === 0) {
    return "No confluences found in the specified timeframe.";
  }

  let message = `📊 *PERFORMANCE RECAP (${formatTimeframe(timeframeHours)})*\n\n`;

  // Format Top Wallets section
  const topWallets = data.walletPerformance?.slice(0, 3) || [];
  
  if (topWallets.length > 0) {
    message += `👑 *Top Wallets*\n`;
    
    const medals = ['🥇', '🥈', '🥉'];
    
    topWallets.forEach((wallet, index) => {
      const medal = medals[index] || ' ';
      
      // Calculate success metrics
      const successRate = (wallet.successRate * 100).toFixed(0);
      const avgGain = wallet.avgGain.toFixed(0);
      
      // Additional metrics for high-value wallets
      const bigWins = wallet.bigWinConfluences || 0; // 200%+ gains
      const hugeWins = wallet.hugeWinConfluences || 0; // 500%+ gains
      const isEarlyDetector = wallet.earlyDetections >= 2;
      
      // Make the display more informative based on wallet strengths
      let walletInfo;
      
      if (hugeWins > 0) {
        // Emphasize wallets with huge wins
        walletInfo = `${successRate}% win rate, ${hugeWins}x +500%`;
      } else if (bigWins > 0) {
        // Emphasize wallets with big wins
        walletInfo = `${successRate}% win rate, ${bigWins}x +200%`;
      } else if (isEarlyDetector) {
        // Emphasize early detection
        walletInfo = `${successRate}% win rate, early detector`;
      } else {
        // Default display
        walletInfo = `${successRate}% win rate, avg: ${avgGain}%`;
      }
      
      message += ` ${medal} ${wallet.walletName} (${walletInfo})\n`;
    });
    
    message += '\n';
  }

  // Format Group Stats section
  const stats = data.groupStats || {};
  message += `📊 *Group Stats*\n`;
  message += ` ├ Period:    ${formatTimeframe(timeframeHours)}\n`;
  message += ` ├ Confluences:     ${stats.totalConfluences || 0}\n`;
  
  if (stats.hitRate) {
    message += ` ├ Hit Rate:  ${Math.round(stats.hitRate)}% (>100% gain)\n`;
  }
  
  if (stats.medianGain) {
    message += ` ├ Median:    ${Math.round(stats.medianGain)}%\n`;
  }
  
  if (stats.avgPnL) {
    message += ` └ Avg PnL: ${Math.round(stats.avgPnL)}%\n`;
  } else {
    message += ` └ Data:     Limited\n`;
  }
  
  message += '\n';

  // Format Performance section with tokens and their gains
  const tokensWithPerformance = data.confluences
    .filter(conf => conf.performance)
    .sort((a, b) => 
      (b.performance?.percentageGain || 0) - (a.performance?.percentageGain || 0)
    );
  
  if (tokensWithPerformance.length > 0) {
    message += `*Performance:*\n`;
    
    // Limit to 15 tokens to avoid messages that are too long
    const displayLimit = 15;
    const tokensToShow = tokensWithPerformance.slice(0, displayLimit);
    
    tokensToShow.forEach(token => {
      const gain = token.performance.percentageGain;
      const time = token.performance.minutesToATH === 0 ? 
        '0m' : token.performance.timeToATHFormatted || '?';
      
      // Include initial market cap
      const initialMcap = token.performance.initialMarketCap;
      const formattedMcap = formatMarketCap(initialMcap);
      
      // Get appropriate emoji based on gain percentage
      const emoji = getPerformanceEmoji(gain);
      
      // Format message with emoji, token name, gain%, time to ATH, and initial MCAP
      // Use the sign for negative values, but not for positive (which already have a + sign implied)
      const gainSign = gain < 0 ? '' : '+';
      message += `   ${emoji} ${token.tokenName} (${gainSign}${Math.round(gain)}% in ${time}, MCAP: ${formattedMcap})\n`;
    });
    
    if (tokensWithPerformance.length > displayLimit) {
      message += `   • ...and ${tokensWithPerformance.length - displayLimit} more\n`;
    }
  } else {
    message += `*No performance data available yet.*\n`;
  }

  return message;
}

/**
 * Send a recap message, handling long messages properly
 * @param {Object} bot - Telegram bot instance
 * @param {number} chatId - Chat ID
 * @param {number} messageId - Message ID to edit
 * @param {Object} data - Performance data
 * @param {number} timeframeHours - Timeframe in hours
 * @returns {Promise<void>}
 */
async function sendRecapMessage(bot, chatId, messageId, data, timeframeHours) {
  const message = formatRecapMessage(data, timeframeHours);
  
  await sendLongMessage(bot, chatId, messageId, message, {
    maxLength: 3800,
    minChunkSize: 200
  });
}

module.exports = {
  formatTimeframe,
  getPerformanceEmoji,
  formatMarketCap,
  formatRecapMessage,
  sendRecapMessage
};