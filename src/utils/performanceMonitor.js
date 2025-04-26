// src/utils/performanceMonitor.js
const logger = require('./logger');

/**
 * Performance monitoring utility
 * Tracks execution times and provides alerts when operations become slow
 */
class PerformanceMonitor {
  constructor() {
    // Store performance metrics
    this.metrics = {
      // Track confluence detection performance
      confluenceDetection: {
        times: [], // Array of recent execution times
        avg: 0,     // Moving average
        max: 0,     // Max time detected
        alerts: 0,  // Number of alerts triggered
        lastAlertTime: 0 // Timestamp of last alert
      },
      
      // Track transaction processing performance
      transactionProcessing: {
        times: [],
        avg: 0,
        max: 0,
        alerts: 0,
        lastAlertTime: 0
      },
      
      // Track MongoDB query performance
      mongoQueries: {
        times: [],
        avg: 0,
        max: 0,
        alerts: 0,
        lastAlertTime: 0
      }
    };
    
    // Configuration
    this.config = {
      maxSamples: 100, // Number of samples to keep for moving average
      alertThresholds: {
        confluenceDetection: 1000, // 1 second
        transactionProcessing: 500, // 500 ms
        mongoQueries: 200 // 200 ms
      },
      alertCooldown: 300000, // 5 minutes between alerts for the same category
    };
    
    // Initialize timestamp for periodic reporting
    this.lastReportTime = Date.now();
    this.reportInterval = 3600000; // Report every hour
  }
  
  /**
   * Start measuring performance for an operation
   * @returns {Object} Timer object to pass to endTimer
   */
  startTimer() {
    return {
      startTime: process.hrtime()
    };
  }
  
  /**
   * End performance measurement and record metrics
   * @param {Object} timer - Timer object from startTimer
   * @param {string} category - Category of operation ('confluenceDetection', 'transactionProcessing', 'mongoQueries')
   * @param {string} operation - Specific operation name (optional)
   * @returns {number} Execution time in milliseconds
   */
  endTimer(timer, category, operation = '') {
    if (!timer || !timer.startTime) {
      logger.warn('Invalid timer object passed to endTimer');
      return 0;
    }
    
    // Calculate elapsed time
    const diff = process.hrtime(timer.startTime);
    const timeMs = (diff[0] * 1e9 + diff[1]) / 1e6; // Convert to milliseconds
    
    // Only record if category is valid
    if (this.metrics[category]) {
      this.recordMetric(category, timeMs, operation);
      
      // Check if slow operation
      if (timeMs > this.config.alertThresholds[category]) {
        this.triggerAlert(category, timeMs, operation);
      }
    }
    
    // Check if it's time for a periodic report
    const now = Date.now();
    if (now - this.lastReportTime > this.reportInterval) {
      this.generatePerformanceReport();
      this.lastReportTime = now;
    }
    
    return timeMs;
  }
  
  /**
   * Record a performance metric
   * @param {string} category - Metric category
   * @param {number} timeMs - Time in milliseconds
   * @param {string} operation - Operation name
   */
  recordMetric(category, timeMs, operation) {
    const metrics = this.metrics[category];
    
    // Add to recent times, limit array size
    metrics.times.push({
      time: timeMs,
      operation,
      timestamp: Date.now()
    });
    
    // Keep array size limited
    if (metrics.times.length > this.config.maxSamples) {
      metrics.times.shift();
    }
    
    // Update stats
    metrics.avg = metrics.times.reduce((sum, entry) => sum + entry.time, 0) / metrics.times.length;
    metrics.max = Math.max(metrics.max, timeMs);
  }
  
  /**
   * Trigger performance alert
   * @param {string} category - Alert category
   * @param {number} timeMs - Time in milliseconds
   * @param {string} operation - Operation name
   */
  triggerAlert(category, timeMs, operation) {
    const now = Date.now();
    const metrics = this.metrics[category];
    
    // Only alert if cooldown period has passed
    if (now - metrics.lastAlertTime > this.config.alertCooldown) {
      metrics.alerts++;
      metrics.lastAlertTime = now;
      
      const threshold = this.config.alertThresholds[category];
      const percentOver = Math.round((timeMs / threshold - 1) * 100);
      
      logger.warn(`⚠️ PERFORMANCE ALERT: ${category} operation "${operation}" took ${timeMs.toFixed(2)}ms (${percentOver}% over threshold)`);
      logger.warn(`This is alert #${metrics.alerts} for ${category}. Average: ${metrics.avg.toFixed(2)}ms, Max: ${metrics.max.toFixed(2)}ms`);
      
      // Additional details for confluence detection
      if (category === 'confluenceDetection' && timeMs > threshold * 2) {
        logger.warn(`Severe slowdown detected in confluence processing. Consider optimizing queries or increasing resources.`);
      }
    }
  }
  
  /**
   * Generate a comprehensive performance report
   */
  generatePerformanceReport() {
    logger.info('========== PERFORMANCE REPORT ==========');
    
    for (const [category, metrics] of Object.entries(this.metrics)) {
      // Skip categories with no data
      if (metrics.times.length === 0) continue;
      
      // Calculate percentiles
      const sortedTimes = [...metrics.times].sort((a, b) => a.time - b.time);
      const p50 = sortedTimes[Math.floor(sortedTimes.length * 0.5)]?.time || 0;
      const p90 = sortedTimes[Math.floor(sortedTimes.length * 0.9)]?.time || 0;
      const p99 = sortedTimes[Math.floor(sortedTimes.length * 0.99)]?.time || 0;
      
      // Find slowest operations
      const slowestOps = [...metrics.times]
        .sort((a, b) => b.time - a.time)
        .slice(0, 3)
        .map(entry => `"${entry.operation}" (${entry.time.toFixed(2)}ms)`);
      
      logger.info(`${category.toUpperCase()}: Avg=${metrics.avg.toFixed(2)}ms, Max=${metrics.max.toFixed(2)}ms`);
      logger.info(`  - Percentiles: P50=${p50.toFixed(2)}ms, P90=${p90.toFixed(2)}ms, P99=${p99.toFixed(2)}ms`);
      logger.info(`  - Alerts: ${metrics.alerts} | Samples: ${metrics.times.length}`);
      
      if (slowestOps.length > 0) {
        logger.info(`  - Slowest operations: ${slowestOps.join(', ')}`);
      }
      
      // Alert if P90 is approaching threshold
      const threshold = this.config.alertThresholds[category];
      if (p90 > threshold * 0.7) {
        logger.warn(`  ⚠️ 90% of ${category} operations are taking more than ${p90.toFixed(2)}ms (threshold: ${threshold}ms)`);
      }
    }
    
    logger.info('=========================================');
  }
  
  /**
   * Reset all metrics
   */
  resetMetrics() {
    for (const category in this.metrics) {
      this.metrics[category] = {
        times: [],
        avg: 0,
        max: 0,
        alerts: 0,
        lastAlertTime: 0
      };
    }
    logger.info('Performance metrics have been reset');
  }
}

// Create and export singleton instance
const performanceMonitor = new PerformanceMonitor();
module.exports = performanceMonitor;