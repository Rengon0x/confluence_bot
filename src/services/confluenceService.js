// src/services/confluenceService.js
/**
 * Facade module for the confluence service
 * Redirects to the new modular implementation
 * This provides compatibility with the existing code structure
 */

const logger = require('../utils/logger');

/**
 * Initialize with the integrated version of the service that uses DB persistence
 */
async function initializeService() {
  const integratedService = require('./confluence/index');
  await integratedService.initialize();
  return integratedService;
}

// Export a promise that resolves to the real service
// This allows immediate importing while ensuring initialization happens
const servicePromise = initializeService().catch(err => {
  logger.error(`Failed to initialize optimized confluence service: ${err.message}`);
  logger.warn('Falling back to standard confluence service');
  return require('./confluence/legacyIndex');
});

// Create a proxy to the real service that waits for initialization
const confluenceService = new Proxy({}, {
  get: function(target, prop) {
    return async (...args) => {
      const service = await servicePromise;
      if (typeof service[prop] === 'function') {
        return service[prop](...args);
      } else {
        return service[prop];
      }
    };
  }
});

module.exports = confluenceService;