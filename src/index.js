require('dotenv').config();
const logger = require('./utils/logger');
const db = require('./db');
const { startBot } = require('./bot');
const { startForwarder } = require('./forwarder');
const confluenceService = require('./services/confluenceService'); 
const transactionService = require('./db/services/transactionService');
const cleanupService = require('./db/services/cleanupService');
const queueManager = require('./services/queueService');
const performanceMonitor = require('./utils/performanceMonitor');

/**
 * Main application entry point
 */

async function startApp() {
  try {
    // Connect to MongoDB
    await db.connectToDatabase();
    logger.info('MongoDB connection established');

    // Run database cleanup for orphaned transactions
    logger.info('Running database cleanup...');
    const cleanupResult = await cleanupService.runAllCleanupTasks();
    logger.info(`Database cleanup completed: ${cleanupResult.orphanedTransactionsDeleted} orphaned transactions removed in ${cleanupResult.duration}ms`);

    // Initialize the confluence service
    await confluenceService.initialize();
    logger.info('Confluence service initialized');
    
    // Start the bot
    const bot = startBot();
    logger.info('Bot started successfully');
    
    // Start the forwarder
    const forwarder = await startForwarder();
    logger.info('Forwarder started successfully');

    // Setup periodic cleanup for transactions
    setInterval(async () => {
      // MongoDB cleanup - every hour
      await transactionService.cleanupOldTransactions(48);
      
      // Cache cleanup - every 10 minutes
      await confluenceService.cleanOldTransactions();
      
      // Check and log resource usage
      const cacheStats = await confluenceService.estimateCacheSize();
      const dbStats = await transactionService.getCollectionSize();
      
      // Get queue stats
      const queueStats = queueManager.getAllQueueStats();
      const queueGroups = Object.keys(queueStats).length;
      const queuePending = Object.values(queueStats).reduce((sum, stats) => sum + stats.length, 0);
      const queueProcessed = Object.values(queueStats).reduce((sum, stats) => sum + stats.processed, 0);
      
      logger.info(`Resource usage - Cache: ${cacheStats.estimatedSizeMB.toFixed(2)}MB (${cacheStats.totalEntries} entries), MongoDB: ${dbStats ? dbStats.sizeMB.toFixed(2) + 'MB' : 'unknown'}, Queues: ${queueGroups} groups, ${queuePending} pending, ${queueProcessed} processed`);
      
      // Generate performance report every hour
      const currentHour = new Date().getHours();
      const lastHour = new Date(Date.now() - 3600000).getHours();
      if (currentHour !== lastHour) {
        // Generate a full performance report at the top of each hour
        performanceMonitor.generatePerformanceReport();
      }
    }, 600000); // 10 minutes
    
    // Setup daily cleanup for orphaned transactions
    setInterval(async () => {
      logger.info('Running daily cleanup for orphaned transactions...');
      const cleanupResult = await cleanupService.runAllCleanupTasks();
      logger.info(`Daily cleanup completed: ${cleanupResult.orphanedTransactionsDeleted} orphaned transactions removed`);
    }, 24 * 60 * 60 * 1000); // Run once per day
    
    // Setup detailed performance monitoring for slow operations
    setInterval(() => {
      // Check if any slow operations have happened in the last minute
      const confluenceMetrics = performanceMonitor.metrics.confluenceDetection;
      const recentConfluenceOps = confluenceMetrics.times
        .filter(t => Date.now() - t.timestamp < 60000) // Last minute
        .sort((a, b) => b.time - a.time); // Slowest first
        
      if (recentConfluenceOps.length > 0) {
        const slowOps = recentConfluenceOps.filter(op => op.time > 1000); // > 1 second
        
        if (slowOps.length > 0) {
          // We found slow operations
          const slowestOp = slowOps[0];
          logger.warn(`⏱️ Performance Alert: Detected ${slowOps.length} slow confluence operations in the last minute. Slowest: ${slowestOp.operation} (${slowestOp.time.toFixed(2)}ms)`);
          
          // Suggest optimization if there are repeated slow operations for the same group
          const groupCounts = {};
          for (const op of slowOps) {
            const groupMatch = op.operation.match(/check_group_([^_]+)/);
            if (groupMatch) {
              const groupId = groupMatch[1];
              groupCounts[groupId] = (groupCounts[groupId] || 0) + 1;
            }
          }
          
          const problematicGroups = Object.entries(groupCounts)
            .filter(([_, count]) => count > 2)
            .map(([groupId]) => groupId);
            
          if (problematicGroups.length > 0) {
            logger.warn(`Consider optimizing data for group(s): ${problematicGroups.join(', ')}`);
          }
        }
      }
    }, 60000); // Check every minute
    
    logger.info('Application successfully started');
    
    // Handle cleanup
    process.on('SIGINT', async () => {
      logger.info('Application shutting down...');
      if (forwarder && forwarder.stop) {
        await forwarder.stop();
      }
      // Shut down the queue manager
      queueManager.shutdown();
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      logger.info('Application terminating...');
      if (forwarder && forwarder.stop) {
        await forwarder.stop();
      }
      // Shut down the queue manager
      queueManager.shutdown();
      process.exit(0);
    });
    
  } catch (error) {
    logger.error('Failed to start application:', error);
    process.exit(1);
  }
}

// Start the application
startApp().catch(err => {
  logger.error('Error starting app:', err);
  process.exit(1);
});