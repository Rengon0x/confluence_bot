const logger = require('../../../../utils/logger');

/**
 * Creates a progress update handler function for Telegram
 * @param {Object} bot - Telegram bot instance
 * @param {number} chatId - Chat ID
 * @param {number} messageId - Message ID to update
 * @returns {Function} - A function that can be called to update progress
 */
function createProgressHandler(bot, chatId, messageId) {
  return async function updateProgress(
    currentBatch, 
    totalBatches, 
    batchStart, 
    batchEnd, 
    totalTokens, 
    processedCount
  ) {
    try {
      await bot.editMessageText(
        `⏳ Analyzing batch ${currentBatch+1}/${totalBatches} (tokens ${batchStart+1}-${batchEnd} of ${totalTokens})...\n\nResults processed so far: ${processedCount}`,
        {
          chat_id: chatId,
          message_id: messageId
        }
      );
    } catch (error) {
      logger.warn(`Failed to update progress message: ${error.message}`);
    }
  };
}

/**
 * Create status message for confluence filtering
 * @param {number} realTokenCount - Number of real tokens
 * @param {number} totalConfluences - Total number of confluences 
 * @param {number} minWallets - Minimum wallets setting
 * @returns {string} - Status message
 */
function createFilterStatusMessage(realTokenCount, totalConfluences, minWallets) {
  return `⏳ Found ${realTokenCount} valid tokens with at least ${minWallets} wallets out of ${totalConfluences} total confluences.\n\nStarting analysis with detection point at ${minWallets}th wallet...`;
}

/**
 * Create a completion message
 * @param {number} successCount - Number of successfully processed tokens
 * @param {number} totalCount - Total number of tokens attempted
 * @returns {string} - Completion message
 */
function createCompletionMessage(successCount, totalCount) {
  return `⏳ Analysis complete for ${successCount}/${totalCount} tokens. Formatting comprehensive results...`;
}

/**
 * Create error message when no results are found
 * @param {number} totalConfluences - Total confluences in the system
 * @returns {string} - Error message
 */
function createNoResultsMessage(totalConfluences) {
  return `Unable to retrieve price data for any tokens. This could be due to:\n\n` +
          `• API rate limits exceeded\n` + 
          `• Temporary Birdeye API issues\n` +
          `• New tokens not yet tracked by Birdeye\n` +
          `• Invalid token addresses\n\n` +
          `Total confluences found: ${totalConfluences}`;
}

module.exports = {
  createProgressHandler,
  createFilterStatusMessage,
  createCompletionMessage,
  createNoResultsMessage
};