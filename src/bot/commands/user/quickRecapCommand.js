// src/bot/commands/user/quickRecapCommand.js
const logger = require('../../../utils/logger');
const recapService = require('../../../services/recapService');
const birdeyeService = require('../../../services/birdeyeService');

/**
 * Command /quickrecap - Shows a quick ATH summary of tokens with confluences
 * Optional parameter: number of tokens to analyze (e.g., /quickrecap 20)
 */
const quickRecapCommand = {
  name: 'quickrecap',
  regex: /\/quickrecap(?:@\w+)?(?:\s+(\d+))?/,
  description: 'View a summary of confluences ATH performance (optionally specify number of tokens to analyze)',
  handler: async (bot, msg, match) => {
    try {
      // Only respond in groups
      if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') {
        bot.sendMessage(msg.chat.id, "This command can only be used in groups.");
        return;
      }
      
      const chatId = msg.chat.id;
      
      // Check if a token limit was provided as parameter
      const requestedTokenCount = match && match[1] ? parseInt(match[1], 10) : 10; // Default to 10 if not specified
      const maxTokenLimit = 25; // Set a reasonable upper limit to avoid API overload
      const tokenLimit = Math.min(requestedTokenCount, maxTokenLimit);
      
      // Inform the user that we're processing their request
      const loadingMsg = await bot.sendMessage(
        chatId, 
        `⏳ Analyzing token performance for up to ${tokenLimit} tokens... This may take a minute as I fetch price data.`
      );
      
      // Get confluences for this group
      const confluences = await recapService.getFirstConfluencesPerToken(chatId.toString(), false);
      
      if (confluences.length === 0) {
        await bot.editMessageText(
          "No confluences detected in the last 48 hours.",
          {
            chat_id: chatId,
            message_id: loadingMsg.message_id
          }
        );
        return;
      }
      
      // Filter to only tokens with addresses (needed for Birdeye API)
      const confluencesWithAddresses = confluences.filter(conf => 
        conf.tokenAddress && conf.tokenAddress.trim().length > 0
      );
      
      if (confluencesWithAddresses.length === 0) {
        await bot.editMessageText(
          "No tokens with valid addresses found in recent confluences.",
          {
            chat_id: chatId,
            message_id: loadingMsg.message_id
          }
        );
        return;
      }
      
      // Vérifier que les addresses ne sont pas des adresses simulées/test
      const realTokens = confluencesWithAddresses.filter(conf => 
        !conf.tokenAddress.startsWith('SIM') && conf.tokenAddress.length >= 30
      );
      
      if (realTokens.length === 0) {
        await bot.editMessageText(
          "No real token addresses found in recent confluences. Addresses starting with 'SIM' are ignored as they are test tokens.",
          {
            chat_id: chatId,
            message_id: loadingMsg.message_id
          }
        );
        return;
      }
      
      // Update loading message to show progress
      await bot.editMessageText(
        `⏳ Found ${realTokens.length} tokens with valid addresses. Will analyze up to ${tokenLimit} of them...`,
        {
          chat_id: chatId,
          message_id: loadingMsg.message_id
        }
      );
      
      // Limit to the specified number of tokens
      const tokensToAnalyze = realTokens.slice(0, tokenLimit);
      
      if (realTokens.length > tokenLimit) {
        await bot.editMessageText(
          `⏳ Analyzing ${tokenLimit} most recent tokens out of ${realTokens.length} total...`,
          {
            chat_id: chatId,
            message_id: loadingMsg.message_id
          }
        );
      }
      
      // Prepare tokens data for batch processing
      const tokensData = tokensToAnalyze.map(conf => ({
        tokenAddress: conf.tokenAddress,
        tokenName: conf.tokenName,
        detectionTime: new Date(conf.detectionTimestamp),
        initialMarketCap: conf.detectionMarketCap
      }));
      
      // Use batch processing to find ATH (All-Time High)
      const athResults = await birdeyeService.batchProcessATH(tokensData);
      
      // Update loading message to show we're formatting the results
      await bot.editMessageText(
        `⏳ Analysis complete for ${athResults.length} tokens. Formatting results...`,
        {
          chat_id: chatId,
          message_id: loadingMsg.message_id
        }
      );
      
      // Si aucun token n'a été analysé avec succès
      if (athResults.length === 0) {
        await bot.editMessageText(
          `Unable to retrieve price data for any tokens. This could be due to:\n\n` +
          `• Temporary Birdeye API issues\n` +
          `• New tokens not yet tracked by Birdeye\n` +
          `• Invalid token addresses\n\n` +
          `Total confluences found: ${confluences.length}`,
          {
            chat_id: chatId,
            message_id: loadingMsg.message_id
          }
        );
        return;
      }
      
      // Format the performance summary
      const summaryMessage = formatQuickRecapSummary(athResults, confluences.length, requestedTokenCount);
      
      // Send or edit the message
      await bot.editMessageText(
        summaryMessage,
        {
          chat_id: chatId,
          message_id: loadingMsg.message_id,
          parse_mode: 'Markdown'
        }
      );
      
      logger.info(`QuickRecap command executed for group ${chatId}, analyzed ${athResults.length}/${realTokens.length} tokens (user requested: ${requestedTokenCount})`);
    } catch (error) {
      logger.error(`Error in quickrecap command: ${error.message}`);
      bot.sendMessage(
        msg.chat.id,
        `❌ An error occurred while analyzing token performance: ${error.message}`
      );
    }
  }
};

/**
 * Format the quick recap summary message
 * @param {Array} athResults - Results of ATH analysis
 * @param {number} totalConfluences - Total number of confluences
 * @param {number} requestedCount - Number of tokens the user requested to analyze
 * @returns {string} - Formatted message
 */
function formatQuickRecapSummary(athResults, totalConfluences, requestedCount) {
  if (!athResults || athResults.length === 0) {
    return "No performance data available for recent confluences.";
  }
  
  // Performance categories
  const categories = {
    negative: { count: 0, tokens: [], emoji: '💥', label: '-50% or worse' },
    slight_negative: { count: 0, tokens: [], emoji: '📉', label: '-50% to 0%' },
    low: { count: 0, tokens: [], emoji: '➡️', label: '0% to 100%' },
    medium: { count: 0, tokens: [], emoji: '📈', label: '100% to 200%' },
    high: { count: 0, tokens: [], emoji: '🚀', label: '200% to 500%' },
    veryHigh: { count: 0, tokens: [], emoji: '🔥', label: '500% to 1000%' },
    extreme: { count: 0, tokens: [], emoji: '💎', label: '1000%+' }
  };
  
  // Track tokens with early drops (for additional section)
  const earlyDropTokens = [];
  
  // Categorize each token based on its ATH performance
  for (const result of athResults) {
    if (!result.athData) continue;
    
    const percentGain = result.athData.percentageGain;
    const timeToATH = result.athData.minutesToATH;
    
    // Check for early drops (50% drop from initial in less than 2 hours)
    if (result.athData.drop50PctDetected) {
      const drop50pct = result.athData.earlyDrops.find(d => d.percentage === 50);
      if (drop50pct && drop50pct.minutesFromDetection <= 120) { // 2 hours or less
        earlyDropTokens.push({
          name: result.tokenName,
          minutesToDrop: drop50pct.minutesFromDetection,
          formattedTime: drop50pct.formattedTime
        });
      }
    }
    
    // Format token entry with percentage gain and time to ATH
    const formattedTime = result.athData.timeToATHFormatted || formatTimeToATH(timeToATH);
    const tokenEntry = `${result.tokenName} (${percentGain.toFixed(0)}% in ${formattedTime})`;
    
    // Add to the appropriate category
    if (percentGain <= -50) {
      categories.negative.count++;
      categories.negative.tokens.push(tokenEntry);
    } else if (percentGain < 0) {
      categories.slight_negative.count++;
      categories.slight_negative.tokens.push(tokenEntry);
    } else if (percentGain < 100) {
      categories.low.count++;
      categories.low.tokens.push(tokenEntry);
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
  
  // Build the summary message
  let message = `📊 *CONFLUENCE PERFORMANCE SUMMARY*\n\n`;
  message += `Total confluences: ${totalConfluences}\n`;
  message += `Analyzed tokens: ${athResults.length}`;
  
  // Add info about requested token count if it differed from analyzed count
  if (requestedCount > athResults.length) {
    message += ` (requested: ${requestedCount})`;
  }
  message += `\n\n`;
  
  // Add performance distribution
  message += `*Performance Distribution:*\n`;
  
  for (const [key, category] of Object.entries(categories)) {
    if (category.count > 0) {
      message += `${category.emoji} *${category.label}*: ${category.count} tokens\n`;
      
      // Add token details for each category
      // Limit to 5 per category for better readability when analyzing more tokens
      const tokensToShow = category.tokens.slice(0, 5);
      if (tokensToShow.length > 0) {
        message += tokensToShow.map(t => `   • ${t}`).join('\n');
        
        // Add note if some tokens are not shown
        if (category.tokens.length > 5) {
          message += `\n   • _...and ${category.tokens.length - 5} more_`;
        }
        
        message += '\n\n';
      }
    }
  }
  
  // Add section for quick dumps (tokens that dropped 50% within 2 hours)
  if (earlyDropTokens.length > 0) {
    message += `\n*Quick Dumps (50% drop in under 2h):*\n`;
    
    // Limit to 10 dumps to keep message size reasonable
    const dumpsToShow = earlyDropTokens.slice(0, 10);
    dumpsToShow.forEach(token => {
      message += `⚡ ${token.name} (dumped in ${token.formattedTime})\n`;
    });
    
    // Add note if not all dumps are shown
    if (earlyDropTokens.length > 10) {
      message += `_...and ${earlyDropTokens.length - 10} more quick dumps_\n`;
    }
    
    message += '\n';
  }
  
  // Add a note about the command's use
  message += `_Note: Percentages show maximum gain after confluence detection._\n`;
  message += `_Use "/quickrecap X" to analyze X most recent tokens (max: 25)._`;
  
  return message;
}

/**
 * Format time to ATH for display
 * @param {number} minutes - Time to ATH in minutes
 * @returns {string} - Formatted time
 */
function formatTimeToATH(minutes) {
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
}

module.exports = quickRecapCommand;