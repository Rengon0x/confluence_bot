const logger = require('../../utils/logger');
const { findSafeCutPoint, stripMarkdown } = require('../../utils/textUtils');

/**
 * Format market cap for display
 * @param {number} marketCap - Market cap value
 * @returns {string} - Formatted market cap
 */
function formatMarketCap(marketCap) {
  if (!marketCap || isNaN(marketCap)) return "Unknown";
  
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
 * Sends a long message with proper splitting if needed
 * @param {Object} bot - Telegram bot instance
 * @param {number} chatId - Chat ID to send message to
 * @param {number} loadingMsgId - ID of the loading message to replace with first part
 * @param {string} message - The long message content
 * @param {Object} options - Additional options
 * @returns {Promise<void>}
 */
async function sendLongMessage(bot, chatId, loadingMsgId, message, options = {}) {
  const maxSafeLength = options.maxLength || 3800;
  const minChunkSize = options.minChunkSize || 200;
  
  try {
    // If the message is short enough, send it at once
    if (message.length <= maxSafeLength) {
      try {
        await bot.editMessageText(
          message,
          {
            chat_id: chatId,
            message_id: loadingMsgId,
            parse_mode: 'Markdown'
          }
        );
        return;
      } catch (editError) {
        // If error with Markdown, retry without formatting
        logger.warn(`Error with Markdown formatting, retrying without parse_mode: ${editError.message}`);
        await bot.editMessageText(
          stripMarkdown(message),
          {
            chat_id: chatId,
            message_id: loadingMsgId
          }
        );
        return;
      }
    }
    
    // For longer messages, split into multiple parts
    // First part - replace the loading message
    let cutPoint = findSafeCutPoint(message, maxSafeLength);
    const firstPart = message.substring(0, cutPoint);
    
    try {
      await bot.editMessageText(
        firstPart + "\n\n_Analysis continues in next message..._",
        {
          chat_id: chatId,
          message_id: loadingMsgId,
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
          message_id: loadingMsgId
        }
      );
    }
    
    // Subsequent parts - send new messages
    let remainingContent = message.substring(cutPoint);
    let messageCount = 1;
    
    while (remainingContent.length > minChunkSize) {
      messageCount++;
      cutPoint = findSafeCutPoint(remainingContent, maxSafeLength);
      
      // Ensure we're not creating tiny fragments
      if (cutPoint < minChunkSize && remainingContent.length > maxSafeLength) {
        cutPoint = findSafeCutPoint(remainingContent, maxSafeLength, 0.8);
      }
      
      const chunk = remainingContent.substring(0, cutPoint);
      
      // Skip sending if chunk is just whitespace or very small
      if (chunk.trim().length < minChunkSize) {
        remainingContent = remainingContent.substring(cutPoint);
        continue;
      }
      
      try {
        // Add a small delay between messages to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
        
        const prefix = `_Part ${messageCount} of analysis:_\n\n`;
        const suffix = remainingContent.length > cutPoint && 
                      remainingContent.substring(cutPoint).trim().length > minChunkSize 
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
  } catch (messageError) {
    logger.error(`Error sending multi-part message: ${messageError.message}`);
    await bot.sendMessage(
      chatId,
      `Error formatting results. Analysis completed but couldn't display full results. Check logs for details.`
    );
  }
}

module.exports = {
  formatMarketCap,
  formatTimeToATH,
  sendLongMessage
};