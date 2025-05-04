// src/services/queueService.js
const NodeCache = require('node-cache');
const logger = require('../utils/logger');
const confluenceService = require('./confluenceService');

/**
 * Memory Queue Manager - In-memory queue system for transaction processing
 * Provides isolated queues per group to ensure transaction isolation
 */
class MemoryQueueManager {
  constructor() {
    // Storage for queues by group
    this.queues = new Map();
    
    // Cache for storing queue state
    this.queueCache = new NodeCache({ 
      stdTTL: 3600, // 1 hour TTL
      checkperiod: 120 // Check every 2 minutes
    });
    
    // Processing status by group
    this.processingStatus = new Map();
    
    // Stats by group
    this.stats = new Map();
    
    // Start queue processor
    this.processorInterval = setInterval(() => this.processAllQueues(), 1000);
    
    // Start stats reporter
    this.statsInterval = setInterval(() => this.reportStats(), 60000); // Every minute
    
    logger.info('Memory Queue Manager initialized');
  }
  
  /**
   * Add a transaction to the queue for a specific group
   * @param {Object} transaction - Transaction data
   * @param {string} groupId - Group ID
   * @returns {Promise<boolean>} - Success status
   */
  async addTransaction(transaction, groupId) {
    if (!this.queues.has(groupId)) {
      this.queues.set(groupId, []);
      this.processingStatus.set(groupId, false);
      this.stats.set(groupId, {
        processed: 0,
        errors: 0,
        lastProcessed: null,
        avgProcessingTime: 0,
        totalProcessingTime: 0
      });
      
      logger.debug(`Created new queue for group ${groupId}`);
    }
    
    // Add to queue
    const queue = this.queues.get(groupId);
    queue.push({
      data: transaction,
      addedAt: Date.now(),
      attempts: 0
    });
    
    // Store queue stats
    this.updateQueueStats(groupId);
    
    if (queue.length % 100 === 0) {
      logger.info(`Queue for group ${groupId} has reached ${queue.length} pending transactions`);
    }
    
    return true;
  }
  
  /**
   * Process queue for a specific group
   * @param {string} groupId - Group ID
   * @returns {Promise<void>}
   */
  async processQueue(groupId) {
    // Skip if already processing or empty
    if (this.processingStatus.get(groupId) || !this.queues.has(groupId)) {
      return;
    }
    
    const queue = this.queues.get(groupId);
    if (queue.length === 0) return;
    
    try {
      // Mark as processing
      this.processingStatus.set(groupId, true);
      
      // Process up to 10 items at once (batch processing)
      const batchSize = Math.min(10, queue.length);
      const batch = queue.splice(0, batchSize);
      
      logger.debug(`Processing batch of ${batch.length} transactions for group ${groupId}`);
      
      // Process in group isolation
      for (const job of batch) {
        try {
          const startTime = Date.now();
          
          // Process the transaction
          await this.processTransactionForGroup(job.data, groupId);
          
          // Track processing time
          const processingTime = Date.now() - startTime;
          
          // Update statistics
          const stats = this.stats.get(groupId);
          stats.processed++;
          stats.lastProcessed = Date.now();
          
          // Update average processing time
          stats.totalProcessingTime += processingTime;
          stats.avgProcessingTime = stats.totalProcessingTime / stats.processed;
          
        } catch (error) {
          logger.error(`Error processing transaction for group ${groupId}:`, error);
          
          // Retry if attempts < 3
          if (job.attempts < 3) {
            job.attempts++;
            // Add delay based on retry count (exponential backoff)
            setTimeout(() => {
              queue.unshift(job); // Put back at front of queue
              logger.debug(`Retrying transaction for group ${groupId}, attempt ${job.attempts}`);
            }, Math.pow(2, job.attempts) * 1000); // 2s, 4s, 8s
          } else {
            // Record error
            const stats = this.stats.get(groupId);
            stats.errors++;
            logger.error(`Transaction failed after 3 attempts for group ${groupId}`);
          }
        }
      }
      
    } finally {
      // Release processing lock
      this.processingStatus.set(groupId, false);
      
      // Update stats
      this.updateQueueStats(groupId);
    }
  }
  
  /**
   * Process all queues fairly
   * @returns {Promise<void>}
   */
  async processAllQueues() {
    try {
      // Get all groups with pending jobs
      const groupsWithPendingJobs = Array.from(this.queues.keys())
        .filter(groupId => this.queues.get(groupId).length > 0);
      
      if (groupsWithPendingJobs.length === 0) return;
      
      // Process one group at a time, fairly
      for (const groupId of groupsWithPendingJobs) {
        await this.processQueue(groupId);
      }
    } catch (error) {
      logger.error('Error in processAllQueues:', error);
    }
  }
  
  /**
   * Process a transaction for a specific group
   * Uses optimized confluence detection with transaction context
   * @param {Object} transaction - Transaction data
   * @param {string} groupId - Group ID
   * @returns {Promise<boolean>} - Success status
   */
  async processTransactionForGroup(transaction, groupId) {
    try {
      // Extract metadata if available (for confluence filtering)
      const meta = transaction._meta || {};
      delete transaction._meta; // Remove metadata before processing
      
      // Add the transaction to MongoDB via the service
      await require('../db').storeTransaction(transaction, groupId);
      
      // This guarantees that processing happens in isolation for each group
      // Use the context-aware confluence detection to improve performance
      const allConfluences = await confluenceService.checkConfluencesWithContext(groupId, transaction);
      
      // If we have token filtering information and confluences
      if (allConfluences.length > 0 && (meta.currentToken || meta.currentTokenAddress)) {
        // Filter to only show confluences related to the current token
        const relevantConfluences = allConfluences.filter(confluence => 
          confluence.coin === meta.currentToken || 
          (meta.currentTokenAddress && confluence.coinAddress === meta.currentTokenAddress)
        );
        
        // Log the filtering
        if (allConfluences.length > relevantConfluences.length) {
          logger.debug(`Filtered ${allConfluences.length} confluences down to ${relevantConfluences.length} relevant to token ${meta.currentToken || meta.currentTokenAddress}`);
        }
        
        // If relevant confluences are detected, send alerts
        if (relevantConfluences && relevantConfluences.length > 0) {
          const telegramService = require('./telegramService'); // Require here to avoid circular dependencies
          
          for (const confluence of relevantConfluences) {
            try {
              // Format the message
              const message = telegramService.formatConfluenceMessage(confluence);
              
              // Send the alert via bot
              await this.sendConfluenceAlert(groupId, message);
              
              logger.info(`Confluence alert sent for ${confluence.coin} in group ${groupId}: ${confluence.wallets.length} wallets`);
            } catch (alertError) {
              logger.error(`Error sending confluence alert: ${alertError.message}`);
            }
          }
        }
      }
      
      return true;
    } catch (error) {
      logger.error(`Error processing transaction for group ${groupId}: ${error.message}`);
      throw error; // Rethrow to trigger retry mechanism
    }
  }
  
  /**
   * Send a confluence alert to a group
   * @param {string} groupId - ID of the group
   * @param {string} message - Message content
   * @returns {Promise<void>}
   */
  async sendConfluenceAlert(groupId, message) {
    try {
      const axios = require('axios'); // Require here to avoid circular dependencies
      const config = require('../config/config');
      
      // Send the message using the bot API
      await axios.post(`https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`, {
        chat_id: groupId,
        text: message,
        parse_mode: 'HTML'
      });
      
      logger.debug(`Alert sent to group: ${groupId}`);
    } catch (error) {
      logger.error(`Error sending alert to group ${groupId}: ${error.message}`);
      throw error; // Rethrow to trigger retry mechanism
    }
  }
  
  /**
   * Update queue statistics
   * @param {string} groupId - Group ID
   */
  updateQueueStats(groupId) {
    const queue = this.queues.get(groupId);
    const stats = this.stats.get(groupId);
    
    this.queueCache.set(`queue_stats_${groupId}`, {
      length: queue.length,
      processed: stats.processed,
      errors: stats.errors,
      lastProcessed: stats.lastProcessed,
      avgProcessingTime: stats.avgProcessingTime
    });
  }
  
  /**
   * Get statistics for a queue
   * @param {string} groupId - Group ID
   * @returns {Object} - Queue statistics
   */
  getQueueStats(groupId) {
    return this.queueCache.get(`queue_stats_${groupId}`) || {
      length: 0,
      processed: 0,
      errors: 0,
      lastProcessed: null,
      avgProcessingTime: 0
    };
  }
  
  /**
   * Get statistics for all queues
   * @returns {Object} - All queue statistics
   */
  getAllQueueStats() {
    const allStats = {};
    
    for (const groupId of this.queues.keys()) {
      allStats[groupId] = this.getQueueStats(groupId);
    }
    
    return allStats;
  }
  
  /**
   * Report queue statistics
   */
  reportStats() {
    try {
      const allStats = this.getAllQueueStats();
      const groupCount = Object.keys(allStats).length;
      
      if (groupCount === 0) return;
      
      // Calculate totals
      let totalPending = 0;
      let totalProcessed = 0;
      let totalErrors = 0;
      
      for (const [groupId, stats] of Object.entries(allStats)) {
        totalPending += stats.length;
        totalProcessed += stats.processed;
        totalErrors += stats.errors;
      }
      
      logger.info(`Queue stats: ${groupCount} groups, ${totalPending} pending, ${totalProcessed} processed, ${totalErrors} errors`);
      
      // Report individual groups with high pending counts
      for (const [groupId, stats] of Object.entries(allStats)) {
        if (stats.length > 100) {
          logger.warn(`Group ${groupId} has ${stats.length} pending transactions`);
        }
      }
    } catch (error) {
      logger.error('Error reporting queue stats:', error);
    }
  }
  
  /**
   * Cleanup resources when shutting down
   */
  shutdown() {
    clearInterval(this.processorInterval);
    clearInterval(this.statsInterval);
    logger.info('Memory Queue Manager shut down');
  }
}

// Singleton instance
const queueManager = new MemoryQueueManager();

// Initialize the optimized detection immediately
// This is done to ensure we're using the DB-backed detection for better performance
confluenceService.setupQueueProcessor()
  .then(() => logger.info('Queue processor updated to use optimized confluence detection'))
  .catch(err => logger.error(`Failed to update queue processor: ${err.message}`));

module.exports = queueManager;