const logger = require('../../../utils/logger');
const recapService = require('../../../services/recapService');
const birdeyeService = require('../../../services/birdeyeService');
const { sendLongMessage } = require('../../utils/messageUtils');
const {
  processAndFilterConfluences,
  filterValidTokens,
  prepareTokensData,
  processBatches,
  formatComprehensiveAnalysisSummary,
  createProgressHandler,
  createFilterStatusMessage,
  createCompletionMessage,
  createNoResultsMessage
} = require('./analyzeHelpers');

/**
 * Command /analyzeall - Admin command to analyze all available confluences with optional minimum wallet filter
 */
const analyzeAllCommand = {
  name: 'analyzeall',
  regex: /\/analyzeall(?:@\w+)?(?:\s+(\d+))?/,
  description: 'Admin command to analyze ALL available confluences, optionally setting minimum wallets',
  handler: async (bot, msg, match) => {
    try {
      const chatId = msg.chat.id;
      
      // Extract the minimum wallets parameter (default to 2 if not specified)
      const minWallets = match && match[1] ? parseInt(match[1], 10) : 2;
      
      // Inform the user that we're processing a comprehensive analysis
      const loadingMsg = await bot.sendMessage(
        chatId, 
        `⏳ Starting FULL analysis of confluences with at least ${minWallets} wallets. This could take several minutes...`
      );
      
      // Get ALL confluences for this group
      const allConfluences = await recapService.getFirstConfluencesPerToken(chatId.toString(), false);
      
      // Filter and adjust detection timestamp and marketCap based on min wallets
      const adjustedConfluences = processAndFilterConfluences(allConfluences, minWallets);
      
      // Update message if no confluences match the criteria
      if (adjustedConfluences.length === 0) {
        await bot.editMessageText(
          `No confluences with at least ${minWallets} wallets were found in the last 48 hours.`,
          {
            chat_id: chatId,
            message_id: loadingMsg.message_id
          }
        );
        return;
      }
      
      // Filter to valid tokens with real addresses
      const { realTokens, realTokenCount } = filterValidTokens(adjustedConfluences);
      
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
        createFilterStatusMessage(realTokenCount, allConfluences.length, minWallets),
        {
          chat_id: chatId,
          message_id: loadingMsg.message_id
        }
      );
      
      // Configure analysis options
      const analysisOptions = {
        highPrecision: true,
        initialMinutes: 30,
        initialResolution: '1m',
        midResolution: '5m',
        lateResolution: '15m'
      };
      
      // Prepare token data for batch processing
      const tokensData = prepareTokensData(realTokens, analysisOptions);
      
      // Create progress update handler
      const updateProgress = createProgressHandler(bot, chatId, loadingMsg.message_id);
      
      // Process in batches
      const { allResults, failedTokens } = await processBatches(
        tokensData,
        5, // batch size
        async (batch) => await birdeyeService.batchProcessATH(batch),
        updateProgress
      );
      
      // Update the message once processing is complete
      await bot.editMessageText(
        createCompletionMessage(allResults.length, tokensData.length),
        {
          chat_id: chatId,
          message_id: loadingMsg.message_id
        }
      );
      
      // Check if we got any results
      if (allResults.length === 0) {
        await bot.editMessageText(
          createNoResultsMessage(allConfluences.length),
          {
            chat_id: chatId,
            message_id: loadingMsg.message_id
          }
        );
        return;
      }
      
      // Format the comprehensive performance summary
      const summaryMessage = formatComprehensiveAnalysisSummary(
        allResults, 
        failedTokens, 
        allConfluences.length,
        minWallets
      );
      
      // Send results, handling long messages automatically
      await sendLongMessage(bot, chatId, loadingMsg.message_id, summaryMessage);
      
      // Log details about tokens that failed analysis for debugging
      if (failedTokens.length > 0) {
        logger.info(`Failed to analyze ${failedTokens.length} tokens. Details follow:`);
        failedTokens.forEach((token, index) => {
          logger.info(`[${index+1}/${failedTokens.length}] Token ${token.name} (${token.address}): ${token.reason}`);
        });
      }
      
      logger.info(`AdminAnalyzeAll command executed for group ${chatId}, analyzed ${allResults.length}/${realTokens.length} tokens with ${minWallets}+ wallets, ${failedTokens.length} tokens failed`);
    } catch (error) {
      logger.error(`Error in analyzeall command: ${error.message}`);
      bot.sendMessage(
        msg.chat.id,
        `❌ An error occurred during the comprehensive analysis: ${error.message}`
      );
    }
  }
};

module.exports = analyzeAllCommand;