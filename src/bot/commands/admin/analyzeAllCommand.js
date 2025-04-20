// src/bot/commands/admin/analyzeAllCommand.js
const logger = require('../../../utils/logger');
const recapService = require('../../../services/recapService');
const birdeyeService = require('../../../services/birdeyeService');

/**
 * Command /analyzeall - Admin command to analyze all available confluences without limits
 */
const analyzeAllCommand = {
  name: 'analyzeall',
  regex: /\/analyzeall(?:@\w+)?/,
  description: 'Admin command to analyze ALL available confluences',
  handler: async (bot, msg) => {
    try {
      const chatId = msg.chat.id;
      
      // Inform the user that we're processing a comprehensive analysis
      const loadingMsg = await bot.sendMessage(
        chatId, 
        `⏳ Starting FULL analysis of ALL available confluences. This could take several minutes...`
      );
      
      // Get ALL confluences for this group
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
      
      // Filter to only tokens with valid addresses
      const confluencesWithAddresses = confluences.filter(conf => 
        conf.tokenAddress && conf.tokenAddress.trim().length > 0
      );
      
      // Filter out simulated tokens
      const realTokens = confluencesWithAddresses.filter(conf => 
        !conf.tokenAddress.startsWith('SIM') && conf.tokenAddress.length >= 30
      );
      
      if (realTokens.length === 0) {
        await bot.editMessageText(
          "No real token addresses found in recent confluences. All tokens appear to be simulated or have invalid addresses.",
          {
            chat_id: chatId,
            message_id: loadingMsg.message_id
          }
        );
        return;
      }
      
      // Update user on the analysis progress
      await bot.editMessageText(
        `⏳ Found ${realTokens.length} valid tokens out of ${confluences.length} confluences.\n\nStarting full analysis with high precision - this may take a while...`,
        {
          chat_id: chatId,
          message_id: loadingMsg.message_id
        }
      );
      
      // Configure higher precision for price history retrieval
      // These settings will be passed to the birdeyeService
      const analysisOptions = {
        highPrecision: true,   // Enable high precision mode
        initialMinutes: 30,    // First 30 minutes use 1m candles
        initialResolution: '1m', // Resolution for the initial period
        midResolution: '5m',   // Resolution for 30m-2h period
        lateResolution: '15m'  // Resolution for periods beyond 2h
      };
      
      // Prepare tokens data for batch processing
      const tokensData = realTokens.map(conf => ({
        tokenAddress: conf.tokenAddress,
        tokenName: conf.tokenName,
        detectionTime: new Date(conf.detectionTimestamp),
        initialMarketCap: conf.detectionMarketCap,
        options: analysisOptions
      }));
      
      // Process tokens in batches to avoid overloading the API
      const batchSize = 5;  // Reduced batch size for more detailed analysis
      const totalBatches = Math.ceil(tokensData.length / batchSize);
      let allResults = [];
      let failedTokens = [];
      
      for (let i = 0; i < totalBatches; i++) {
        const batchStart = i * batchSize;
        const batchEnd = Math.min(batchStart + batchSize, tokensData.length);
        const batch = tokensData.slice(batchStart, batchEnd);
        
        // Update progress message
        await bot.editMessageText(
          `⏳ Analyzing batch ${i+1}/${totalBatches} (tokens ${batchStart+1}-${batchEnd} of ${tokensData.length})...\n\nResults processed so far: ${allResults.length}`,
          {
            chat_id: chatId,
            message_id: loadingMsg.message_id
          }
        );
        
        // Process this batch
        try {
          const batchResults = await birdeyeService.batchProcessATH(batch);
          
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
        // High precision analysis needs more careful rate limiting
        if (i < totalBatches - 1) {
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }
      
      // Update the message once processing is complete
      await bot.editMessageText(
        `⏳ Analysis complete for ${allResults.length}/${tokensData.length} tokens. Formatting comprehensive results...`,
        {
          chat_id: chatId,
          message_id: loadingMsg.message_id
        }
      );
      
      // Check if we got any results
      if (allResults.length === 0) {
        await bot.editMessageText(
          `Unable to retrieve price data for any tokens. This could be due to:\n\n` +
          `• API rate limits exceeded\n` + 
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
      
      // Format the comprehensive performance summary
      const summaryMessage = formatComprehensiveAnalysisSummary(allResults, failedTokens, confluences.length);
      
      // Send results split into multiple messages if necessary due to length
      try {
        // Split messages into smaller chunks to avoid entity parsing errors
        const maxSafeLength = 3800; // Safer limit than 4096
        const minChunkSize = 200;  // Don't create chunks smaller than this
        
        // If the message is too long, divide it into multiple parts
        if (summaryMessage.length > maxSafeLength) {
          // First part - replace the loading message
          // Find a safe cutting point (end of line)
          let cutPoint = findSafeCutPoint(summaryMessage, maxSafeLength);
          const firstPart = summaryMessage.substring(0, cutPoint);
          
          try {
            await bot.editMessageText(
              firstPart + "\n\n_Analysis continues in next message..._",
              {
                chat_id: chatId,
                message_id: loadingMsg.message_id,
                parse_mode: 'Markdown'
              }
            );
          } catch (editError) {
            // If error with Markdown, retry without formatting
            logger.warn(`Error with Markdown formatting, retrying without parse_mode: ${editError.message}`);
            await bot.editMessageText(
              stripMarkdown(firstPart) + "\n\nAnalysis continues in next message...",
              {
                chat_id: chatId,
                message_id: loadingMsg.message_id
              }
            );
          }
          
          // Subsequent parts - send new messages
          let remainingContent = summaryMessage.substring(cutPoint);
          let messageCount = 1;
          
          while (remainingContent.length > minChunkSize) { // Only process if remaining content is substantial
            messageCount++;
            cutPoint = findSafeCutPoint(remainingContent, maxSafeLength);
            
            // Ensure we're not creating tiny fragments
            if (cutPoint < minChunkSize && remainingContent.length > maxSafeLength) {
              cutPoint = findSafeCutPoint(remainingContent, maxSafeLength, 0.8); // Try with a higher threshold
            }
            
            const chunk = remainingContent.substring(0, cutPoint);
            
            // Skip sending if chunk is just whitespace or very small
            if (chunk.trim().length < minChunkSize) {
              // Just move to the next chunk without sending
              remainingContent = remainingContent.substring(cutPoint);
              continue;
            }
            
            try {
              // Add a small delay between messages to avoid rate limiting
              await new Promise(resolve => setTimeout(resolve, 100));
              
              const prefix = `_Part ${messageCount} of analysis:_\n\n`;
              const suffix = remainingContent.length > cutPoint && remainingContent.substring(cutPoint).trim().length > minChunkSize 
                            ? "\n\n_Continued in next message..._" 
                            : "";
              
              await bot.sendMessage(
                chatId,
                prefix + chunk + suffix,
                {
                  parse_mode: 'Markdown'
                }
              );
            } catch (sendError) {
              // If error with Markdown, retry without formatting
              logger.warn(`Error sending message part ${messageCount}: ${sendError.message}`);
              await bot.sendMessage(
                chatId,
                `Part ${messageCount} of analysis:\n\n` + stripMarkdown(chunk)
              );
            }
            
            remainingContent = remainingContent.substring(cutPoint);
          }
          
          // Send any final small chunk if it contains meaningful content
          if (remainingContent.trim().length > 0) {
            await bot.sendMessage(
              chatId,
              `_Final part of analysis:_\n\n${remainingContent}`,
              {
                parse_mode: 'Markdown'
              }
            );
          }
        } else {
          // If the message is short enough, send it at once
          try {
            await bot.editMessageText(
              summaryMessage,
              {
                chat_id: chatId,
                message_id: loadingMsg.message_id,
                parse_mode: 'Markdown'
              }
            );
          } catch (editError) {
            // If error with Markdown, retry without formatting
            logger.warn(`Error with Markdown formatting in single message: ${editError.message}`);
            await bot.editMessageText(
              stripMarkdown(summaryMessage),
              {
                chat_id: chatId,
                message_id: loadingMsg.message_id
              }
            );
          }
        }
      } catch (messageError) {
        logger.error(`Error sending analysis results: ${messageError.message}`);
        await bot.sendMessage(
          chatId,
          `Error formatting results. Analysis completed but couldn't display full results. Check logs for details.`
        );
      }
      
      // Log details about tokens that failed analysis for debugging
      if (failedTokens.length > 0) {
        logger.info(`Failed to analyze ${failedTokens.length} tokens. Details follow:`);
        failedTokens.forEach((token, index) => {
          logger.info(`[${index+1}/${failedTokens.length}] Token ${token.name} (${token.address}): ${token.reason}`);
        });
      }
      
      logger.info(`AdminAnalyzeAll command executed for group ${chatId}, analyzed ${allResults.length}/${realTokens.length} tokens, ${failedTokens.length} tokens failed`);
    } catch (error) {
      logger.error(`Error in analyzeall command: ${error.message}`);
      bot.sendMessage(
        msg.chat.id,
        `❌ An error occurred during the comprehensive analysis: ${error.message}`
      );
    }
  }
};

/**
 * Format comprehensive analysis summary
 * @param {Array} athResults - Results of ATH analysis
 * @param {Array} failedTokens - Tokens that failed to analyze
 * @param {number} totalConfluences - Total number of confluences
 * @returns {string} - Formatted message
 */
function formatComprehensiveAnalysisSummary(athResults, failedTokens, totalConfluences) {
  if (!athResults || athResults.length === 0) {
    return "No performance data available for analysis.";
  }
  
  // Define new gain categories with the requested ranges
  const categories = {
    extreme_negative: { count: 0, tokens: [], emoji: '💣', label: '-75% or worse' },
    negative: { count: 0, tokens: [], emoji: '💥', label: '-75% to -50%' },
    slight_negative: { count: 0, tokens: [], emoji: '📉', label: '-50% to 0%' },
    tiny_gain: { count: 0, tokens: [], emoji: '➖', label: '0% to +50%' },    // New category
    low_gain: { count: 0, tokens: [], emoji: '➡️', label: '+50% to +100%' },  // Renamed category
    medium: { count: 0, tokens: [], emoji: '📈', label: '+100% to +200%' },
    high: { count: 0, tokens: [], emoji: '🚀', label: '+200% to +500%' },
    veryHigh: { count: 0, tokens: [], emoji: '🔥', label: '+500% to +1000%' },
    extreme: { count: 0, tokens: [], emoji: '💎', label: '+1000%+' }
  };
  
  // Early drops tracking - ONLY include tokens with < 50% gain before dropping (changed from 100%)
  const earlyDropTokens = [];
  
  // Process all results, even those with "0% in 0m" since they might have valid drop data
  for (const result of athResults) {
    if (!result.athData) continue;
    
    const percentGain = result.athData.percentageGain;
    const timeToATH = result.athData.minutesToATH;
    
    // Check specifically for early dumps - tokens that dropped 50% before gaining 50%
    if (result.athData.drop50PctDetected && percentGain < 50) {
      const drop50pct = result.athData.earlyDrops.find(d => d.percentage === 50);
      if (drop50pct && drop50pct.minutesFromDetection <= 120) { // 2 hours or less
        earlyDropTokens.push({
          name: result.tokenName,
          minutesToDrop: drop50pct.minutesFromDetection,
          formattedTime: drop50pct.formattedTime,
          maxGain: percentGain,
          address: result.tokenAddress
        });
      }
    }
    
    // Format token entry with percentage gain and time to ATH
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
    
    const tokenEntry = `${result.tokenName} (${percentGain.toFixed(0)}% in ${formattedTime})`;
    
    // Add to the appropriate category based on the new classification
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
  
  // Calculate some stats for summary
  const totalProcessed = athResults.length;
  const tokensWithGains = categories.tiny_gain.count + categories.low_gain.count + 
                          categories.medium.count + categories.high.count + 
                          categories.veryHigh.count + categories.extreme.count;
  const tokensWithLosses = categories.extreme_negative.count + categories.negative.count + 
                           categories.slight_negative.count;
  const successRate = (tokensWithGains / totalProcessed * 100).toFixed(1);
  
  // Build the summary message
  let message = `📊 *COMPREHENSIVE CONFLUENCE ANALYSIS*\n\n`;
  message += `Total confluences: ${totalConfluences}\n`;
  message += `Tokens analyzed successfully: ${athResults.length}\n`;
  message += `Tokens with analysis issues: ${failedTokens.length}\n`;
  message += `Success rate: ${successRate}% tokens with gains\n\n`;
  
  // Add performance distribution
  message += `*Performance Distribution:*\n`;
  
  // Create distribution table
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
  
  // Add section for quick dumps (tokens that dropped 50% within 2 hours)
  // But only for tokens that didn't gain 50% first
  if (earlyDropTokens.length > 0) {
    message += `\n*Quick Dumps (Tokens with <50% gain that dropped 50% in <2h):*\n`;
    
    // Sort by how quickly they dumped
    earlyDropTokens.sort((a, b) => a.minutesToDrop - b.minutesToDrop);
    
    earlyDropTokens.forEach(token => {
      message += `⚡ ${token.name} (Max gain: ${token.maxGain.toFixed(0)}%, dumped in ${token.formattedTime})\n`;
    });
    
    message += '\n';
  }
  
  // Add summary statistics
  message += `\n*Summary Statistics:*\n`;
  message += `• Total tokens analyzed: ${totalProcessed}\n`;
  message += `• Tokens with gains: ${tokensWithGains} (${(tokensWithGains/totalProcessed*100).toFixed(1)}%)\n`;
  message += `• Tokens with losses: ${tokensWithLosses} (${(tokensWithLosses/totalProcessed*100).toFixed(1)}%)\n`;
  message += `• Quick dumps (<50% gain, -50% in <2h): ${earlyDropTokens.length} (${(earlyDropTokens.length/totalProcessed*100).toFixed(1)}%)\n`;
  message += `• Significant gains (>100%): ${categories.medium.count + categories.high.count + categories.veryHigh.count + categories.extreme.count} (${((categories.medium.count + categories.high.count + categories.veryHigh.count + categories.extreme.count)/totalProcessed*100).toFixed(1)}%)\n`;
  message += `• Excellent gains (>200%): ${categories.high.count + categories.veryHigh.count + categories.extreme.count} (${((categories.high.count + categories.veryHigh.count + categories.extreme.count)/totalProcessed*100).toFixed(1)}%)\n`;
  
  if (failedTokens.length > 0) {
    message += `• Failed tokens: ${failedTokens.length} (Check logs for details)\n`;
  }
  
  message += `\n_Note: This analysis uses high precision 1m candles for the critical first 30 minutes._`;
  
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

/**
 * Finds a safe cutting point to split a long message
 * Preferably cuts at the end of a line to avoid cutting in the middle of a Markdown entity
 * @param {string} text - Text to cut
 * @param {number} maxLength - Maximum length
 * @param {number} threshold - Threshold for minimum acceptable cut position (0.5 means half the maxLength)
 * @returns {number} - Safe cutting position
 */
function findSafeCutPoint(text, maxLength, threshold = 0.5) {
    // First try to find a paragraph break (double newline)
    let cutPoint = text.lastIndexOf('\n\n', maxLength);
    
    // If no paragraph break or it's too close to the beginning, try a single line break
    if (cutPoint < maxLength * threshold) {
      cutPoint = text.lastIndexOf('\n', maxLength);
    }
    
    // If no line break or it's too close to the beginning, try a sentence end
    if (cutPoint < maxLength * threshold) {
      // Look for period followed by space or newline
      for (let i = Math.min(text.length - 1, maxLength); i >= 0; i--) {
        if ((text[i] === '.' || text[i] === '!' || text[i] === '?') && 
            (i + 1 >= text.length || text[i + 1] === ' ' || text[i + 1] === '\n') &&
            i > maxLength * threshold) {
          cutPoint = i + 1;
          break;
        }
      }
    }
    
    // If no sentence end, try a space
    if (cutPoint < maxLength * threshold) {
      cutPoint = text.lastIndexOf(' ', maxLength);
    }
    
    // If still no good cutting point, use maxLength but check for Markdown boundaries
    if (cutPoint < maxLength * threshold) {
      // Try to avoid cutting in the middle of markdown entities
      const markdownEntities = ['*', '_', '`', '[', ']'];
      for (let i = maxLength; i > maxLength * 0.9; i--) {
        if (markdownEntities.includes(text[i])) {
          continue; // Skip positions with markdown characters
        }
        cutPoint = i;
        break;
      }
      
      // If we couldn't find a good point even with the above checks, just use maxLength
      if (cutPoint < maxLength * threshold) {
        cutPoint = maxLength;
      }
    }
    
    return cutPoint;
  }
  
  
  /**
   * Removes Markdown formatting from text
   * @param {string} text - Text with Markdown formatting
   * @returns {string} - Text without formatting
   */
  function stripMarkdown(text) {
    // Replace headings and bold
    let stripped = text.replace(/\*\*/g, '');
    stripped = stripped.replace(/\*/g, '');
    
    // Replace italic
    stripped = stripped.replace(/_([^_]+)_/g, '$1');
    
    // Replace code blocks
    stripped = stripped.replace(/`([^`]+)`/g, '$1');
    
    return stripped;
  }
  
module.exports = analyzeAllCommand;