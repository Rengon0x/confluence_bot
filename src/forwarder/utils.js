// src/forwarder/utils.js
const logger = require('../utils/logger');
const db = require('../db');
const { getClientForTracker } = require('./clientPool');

// Keep track of monitored trackers with their associated clients
const monitoredTrackers = new Map();

/**
 * Start monitoring a tracker
 * @param {string} trackerName - Name of the tracker to monitor
 */
async function startMonitoringTracker(trackerName) {
  try {
    // Ensure trackerName is a string
    if (typeof trackerName !== 'string') {
      logger.error(`Invalid tracker name: ${JSON.stringify(trackerName)}`);
      return false;
    }

    // Remove @ if present
    trackerName = trackerName.replace(/^@/, '');
    
    // Check if we're already monitoring this tracker
    if (monitoredTrackers.has(trackerName)) {
      logger.info(`Already monitoring tracker: ${trackerName}`);
      return true;
    }
    
    logger.info(`Starting to monitor tracker: ${trackerName}`);
    
    // Get the client to use for this tracker
    const client = getClientForTracker(trackerName);
    
    if (!client) {
      logger.error(`No client available for tracker: ${trackerName}`);
      return false;
    }
    
    // Get the entity for this tracker
    logger.debug(`Trying to get entity for tracker: ${trackerName}`);
    
    try {
      const entity = await client.getEntity(trackerName);
      
      if (!entity) {
        logger.error(`Could not find entity for tracker: ${trackerName}`);
        return false;
      }
      
      logger.debug(`Entity found for tracker ${trackerName} with ID: ${entity.id}`);
      
      // Store the tracker info
      monitoredTrackers.set(trackerName, {
        entity,
        startTime: new Date(),
        clientId: Array.from(require('./clientPool').getAllClients().entries())
                      .find(([id, c]) => c === client)?.[0] || 'unknown'
      });
      
      logger.info(`Successfully monitoring tracker: ${trackerName}`);
      return true;
    } catch (entityError) {
      // Try with username format if failed
      try {
        logger.debug(`Trying with username format for: ${trackerName}`);
        const entity = await client.getEntity(`@${trackerName}`);
        
        if (!entity) {
          logger.error(`Could not find entity for tracker with username: @${trackerName}`);
          return false;
        }
        
        logger.debug(`Entity found for tracker @${trackerName} with ID: ${entity.id}`);
        
        // Store the tracker info
        monitoredTrackers.set(trackerName, {
          entity,
          startTime: new Date(),
          clientId: Array.from(require('./clientPool').getAllClients().entries())
                      .find(([id, c]) => c === client)?.[0] || 'unknown'
        });
        
        logger.info(`Successfully monitoring tracker: @${trackerName}`);
        return true;
      } catch (usernameError) {
        logger.error(`Failed with username format too: ${usernameError.message}`);
        return false;
      }
    }
  } catch (error) {
    logger.error(`Error starting to monitor tracker ${trackerName}: ${error.message}`);
    return false;
  }
}

/**
 * Stop monitoring a tracker
 * @param {string} trackerName - Name of the tracker to stop monitoring
 */
async function stopMonitoringTracker(trackerName) {
  try {
    if (!monitoredTrackers.has(trackerName)) {
      logger.warn(`Not currently monitoring tracker: ${trackerName}`);
      return false;
    }
    
    monitoredTrackers.delete(trackerName);
    logger.info(`Stopped monitoring tracker: ${trackerName}`);
    return true;
  } catch (error) {
    logger.error(`Error stopping monitoring for ${trackerName}: ${error.message}`);
    return false;
  }
}

/**
 * Update monitored trackers based on database
 */
async function updateMonitoredTrackers() {
  try {
    // Get all active trackers from the database
    const activeTrackers = await db.getAllActiveTrackers();
    
    logger.debug(`Found ${activeTrackers.length} active trackers in the database`);
    
    // Start monitoring new trackers
    for (const tracker of activeTrackers) {
      const trackerName = tracker.name;
      
      if (typeof trackerName === 'string' && !monitoredTrackers.has(trackerName)) {
        logger.debug(`New tracker found in DB: ${trackerName}`);
        await startMonitoringTracker(trackerName);
      }
    }
    
    // Remove trackers that are no longer in the database
    for (const [trackerName] of monitoredTrackers) {
      const isActive = activeTrackers.some(t => t.name === trackerName);
      if (!isActive) {
        logger.info(`Tracker ${trackerName} is no longer active, removing from monitored list`);
        await stopMonitoringTracker(trackerName);
      }
    }
    
    // Log status
    logger.info(`Currently monitoring ${monitoredTrackers.size} trackers`);
  } catch (error) {
    logger.error(`Error updating monitored trackers: ${error.message}`);
  }
}

/**
 * Dump the state of monitored trackers for debugging
 */
function dumpTrackerState() {
  logger.debug('=== MONITORED TRACKERS STATE ===');
  for (const [name, tracker] of monitoredTrackers.entries()) {
    logger.debug(`Tracker: ${name}`);
    logger.debug(`Entity ID: ${tracker.entity.id}`);
    logger.debug(`Username: ${tracker.entity.username}`);
    logger.debug(`Client ID: ${tracker.clientId}`);
    logger.debug(`Start time: ${tracker.startTime}`);
    logger.debug('----------------------------');
  }
}

module.exports = {
  monitoredTrackers,
  startMonitoringTracker,
  stopMonitoringTracker,
  updateMonitoredTrackers,
  dumpTrackerState
};