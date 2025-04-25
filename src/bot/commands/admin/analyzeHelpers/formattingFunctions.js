const { formatMarketCap, formatTimeToATH } = require('../../../utils/messageUtils');

/**
 * Format comprehensive analysis summary with min wallets info
 * @param {Array} athResults - Results of ATH analysis
 * @param {Array} failedTokens - Tokens that failed to analyze
 * @param {number} totalConfluences - Total number of confluences
 * @param {number} minWallets - Minimum number of wallets used for analysis
 * @returns {string} - Formatted message
 */
function formatComprehensiveAnalysisSummary(athResults, failedTokens, totalConfluences, minWallets) {
  if (!athResults || athResults.length === 0) {
    return "No performance data available for analysis.";
  }
  
  // Define gain categories with the requested ranges
  const categories = {
    extreme_negative: { count: 0, tokens: [], emoji: '💣', label: '-75% or worse', isQuickDump: false },
    negative: { count: 0, tokens: [], emoji: '💥', label: '-75% to -50%', isQuickDump: false },
    slight_negative: { count: 0, tokens: [], emoji: '📉', label: '-50% to 0%', isQuickDump: false },
    tiny_gain: { count: 0, tokens: [], emoji: '➖', label: '0% to +50%', isQuickDump: false },    
    low_gain: { count: 0, tokens: [], emoji: '➡️', label: '+50% to +100%', isQuickDump: false },  
    medium: { count: 0, tokens: [], emoji: '📈', label: '+100% to +200%', isQuickDump: false },
    high: { count: 0, tokens: [], emoji: '🚀', label: '+200% to +500%', isQuickDump: false },
    veryHigh: { count: 0, tokens: [], emoji: '🔥', label: '+500% to +1000%', isQuickDump: false },
    extreme: { count: 0, tokens: [], emoji: '💎', label: '+1000%+', isQuickDump: false },
    quick_dumps: { count: 0, tokens: [], emoji: '⚡', label: 'Quick dumps (50% drop in <2h)', isQuickDump: true }
  };
  
  // Early drops tracking - ONLY include tokens with < 50% gain before dropping
  const earlyDropTokens = [];
  
  // Process all results
  for (const result of athResults) {
    if (!result.athData) continue;
    
    const percentGain = result.athData.percentageGain;
    const timeToATH = result.athData.minutesToATH;
    const initialMCap = result.initialMarketCap; // Capture the initial market cap
    
    // Check specifically for early dumps - tokens that dropped 50% before gaining 50%
    let isQuickDump = false;
    if (result.athData.drop50PctDetected && percentGain < 50) {
      const drop50pct = result.athData.earlyDrops.find(d => d.percentage === 50);
      if (drop50pct && drop50pct.minutesFromDetection <= 120) { // 2 hours or less
        isQuickDump = true;
        
        earlyDropTokens.push({
          name: result.tokenName,
          minutesToDrop: drop50pct.minutesFromDetection,
          formattedTime: drop50pct.formattedTime,
          maxGain: percentGain,
          address: result.tokenAddress,
          mcap: initialMCap // Include MCAP in early drop tokens
        });
      }
    }
    
    // Format token entry with percentage gain, time to ATH, and now include market cap
    let formattedTime;
    if (timeToATH > 0) {
      formattedTime = result.athData.timeToATHFormatted || formatTimeToATH(timeToATH);
    } else if (result.athData.drop50PctDetected) {
      // For tokens that only dropped, show when they hit -50%
      const drop50pct = result.athData.earlyDrops.find(d => d.percentage === 50);
      formattedTime = drop50pct ? drop50pct.formattedTime : "N/A";
    } else {
      formattedTime = "N/A";
    }
    
    // Format market cap for display
    const formattedMCap = formatMarketCap(initialMCap);
    
    // Token entry format including market cap and quick dump indicator if applicable
    let tokenEntry = `${result.tokenName} (${percentGain.toFixed(0)}% in ${formattedTime}, MCAP: $${formattedMCap})`;
    
    // Add quick dump indicator to the token entry if applicable
    if (isQuickDump) {
      tokenEntry = `${result.tokenName} (${percentGain.toFixed(0)}% then -50% in ${earlyDropTokens.find(t => t.name === result.tokenName).formattedTime}, MCAP: $${formattedMCap})`;
      
      // Add to quick dumps category
      categories.quick_dumps.count++;
      categories.quick_dumps.tokens.push(tokenEntry);
    }
    
    // Add to the appropriate performance category regardless of whether it's a quick dump or not
    if (percentGain <= -75) {
      categories.extreme_negative.count++;
      categories.extreme_negative.tokens.push(tokenEntry);
    } else if (percentGain <= -50) {
      categories.negative.count++;
      categories.negative.tokens.push(tokenEntry);
    } else if (percentGain < 0) {
      categories.slight_negative.count++;
      categories.slight_negative.tokens.push(tokenEntry);
    } else if (percentGain < 50) {  // New category: 0% to 50%
      categories.tiny_gain.count++;
      categories.tiny_gain.tokens.push(tokenEntry);
    } else if (percentGain < 100) { // Renamed category: 50% to 100%
      categories.low_gain.count++;
      categories.low_gain.tokens.push(tokenEntry);
    } else if (percentGain < 200) {
      categories.medium.count++;
      categories.medium.tokens.push(tokenEntry);
    } else if (percentGain < 500) {
      categories.high.count++;
      categories.high.tokens.push(tokenEntry);
    } else if (percentGain < 1000) {
      categories.veryHigh.count++;
      categories.veryHigh.tokens.push(tokenEntry);
    } else {
      categories.extreme.count++;
      categories.extreme.tokens.push(tokenEntry);
    }
  }
  
  // Calculate stats for summary
  const totalProcessed = athResults.length;
  const tokensWithGains = categories.tiny_gain.count + categories.low_gain.count + 
                        categories.medium.count + categories.high.count + 
                        categories.veryHigh.count + categories.extreme.count;
  const tokensWithLosses = categories.extreme_negative.count + categories.negative.count + 
                         categories.slight_negative.count;
  const successRate = (tokensWithGains / totalProcessed * 100).toFixed(1);
  
  // Build the summary message with minimum wallets info
  let message = `📊 *COMPREHENSIVE CONFLUENCE ANALYSIS (${minWallets}+ WALLETS)*\n\n`;
  message += `Total original confluences: ${totalConfluences}\n`;
  message += `Confluences with ${minWallets}+ wallets analyzed: ${athResults.length}\n`;
  message += `Tokens with analysis issues: ${failedTokens.length}\n`;
  message += `Success rate: ${successRate}% tokens with gains\n\n`;
  
  // Add performance distribution
  message += `*Performance Distribution:*\n`;
  
  // Create distribution table, including quick dumps category
  let distributionTable = '';
  for (const [key, category] of Object.entries(categories)) {
    if (category.count > 0) {
      const percentage = (category.count / totalProcessed * 100).toFixed(1);
      distributionTable += `${category.emoji} *${category.label}*: ${category.count} tokens (${percentage}%)\n`;
    }
  }
  message += distributionTable + '\n';
  
  // Add detailed category breakdowns
  message += `*Category Details:*\n`;
  
  for (const [key, category] of Object.entries(categories)) {
    if (category.count > 0) {
      message += `\n${category.emoji} *${category.label}* (${category.count} tokens):\n`;
      
      // Sort tokens by performance if possible (try to extract percentage from the string)
      try {
        category.tokens.sort((a, b) => {
          const aMatch = a.match(/\((-?\d+)%/);
          const bMatch = b.match(/\((-?\d+)%/);
          if (aMatch && bMatch) {
            return parseInt(bMatch[1]) - parseInt(aMatch[1]); // Sort descending
          }
          return 0;
        });
      } catch (err) {
        // If sorting fails, continue with original order
      }
      
      // Add all tokens in this category
      message += category.tokens.map(t => `   • ${t}`).join('\n');
      message += '\n';
    }
  }
  
  // Add summary statistics
  message += `\n*Summary Statistics:*\n`;
  message += `• Total tokens analyzed: ${totalProcessed}\n`;
  message += `• Tokens with gains: ${tokensWithGains} (${(tokensWithGains/totalProcessed*100).toFixed(1)}%)\n`;
  message += `• Tokens with losses: ${tokensWithLosses} (${(tokensWithLosses/totalProcessed*100).toFixed(1)}%)\n`;
  message += `• Quick dumps (-50% in <2h): ${categories.quick_dumps.count} (${(categories.quick_dumps.count/totalProcessed*100).toFixed(1)}%)\n`;
  message += `• Significant gains (>100%): ${categories.medium.count + categories.high.count + categories.veryHigh.count + categories.extreme.count} (${((categories.medium.count + categories.high.count + categories.veryHigh.count + categories.extreme.count)/totalProcessed*100).toFixed(1)}%)\n`;
  message += `• Excellent gains (>200%): ${categories.high.count + categories.veryHigh.count + categories.extreme.count} (${((categories.high.count + categories.veryHigh.count + categories.extreme.count)/totalProcessed*100).toFixed(1)}%)\n`;
  
  if (failedTokens.length > 0) {
    message += `• Failed tokens: ${failedTokens.length} (Check logs for details)\n`;
  }
  
  message += `\n_Note: This analysis uses the ${minWallets}th wallet's timestamp and marketcap as the starting point._`;
  message += `\n_Note: Quick dumps are tokens that lost 50% within 2 hours of detection. They're counted in both their performance category and the quick dump category._`;
  
  return message;
}

module.exports = {
  formatComprehensiveAnalysisSummary
};