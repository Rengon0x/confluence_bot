const NodeCache = require('node-cache');
const RedisService = require('./redisService');
const config = require('../config/config');
const logger = require('../utils/logger');

/**
 * Unified cache service that uses either Redis or NodeCache
 * Provides a unified API independent of the underlying implementation
 */
class CacheService {
  constructor(options = {}) {
    this.useRedis = config.redis.enabled;
    this.prefix = options.prefix || '';
    this.ttl = options.stdTTL || (config.confluence.windowMinutes * 60); // Default TTL in seconds
    
    // Initialize the appropriate cache
    if (this.useRedis) {
      logger.info(`Initializing Redis cache with prefix '${this.prefix}'`);
      this.cache = new RedisService({
        stdTTL: this.ttl,
        prefix: this.prefix
      });
    } else {
      logger.info(`Initializing local cache (NodeCache) with TTL of ${this.ttl} seconds`);
      this.cache = new NodeCache({
        stdTTL: this.ttl,
        checkperiod: Math.min(this.ttl / 10, 600),
        useClones: false  // For optimal performance
      });
      
      // Adapt NodeCache API to be compatible with Redis
      this.originalGet = this.cache.get.bind(this.cache);
      this.originalSet = this.cache.set.bind(this.cache);
      this.originalDel = this.cache.del.bind(this.cache);
      this.originalKeys = this.cache.keys.bind(this.cache);
      this.originalFlushAll = this.cache.flushAll.bind(this.cache);
      
      // Override methods to provide a Promise-compatible API
      this.cache.get = async (key) => this.originalGet(key);
      this.cache.set = async (key, value, ttl) => this.originalSet(key, value, ttl);
      this.cache.del = async (key) => this.originalDel(key);
      this.cache.keys = async () => this.originalKeys();
      this.cache.flushAll = async () => this.originalFlushAll();
      
      // Add missing mget API
      this.cache.mget = async (keys) => {
        const result = {};
        for (const key of keys) {
          const value = this.originalGet(key);
          if (value !== undefined) {
            result[key] = value;
          }
        }
        return result;
      };
      
      // Add API to estimate size
      this.cache.estimateSize = async () => {
        const keys = this.originalKeys();
        let totalEntries = 0;
        let estimatedSizeBytes = 0;
        
        for (const key of keys) {
          const value = this.originalGet(key);
          if (Array.isArray(value)) {
            totalEntries += value.length;
            estimatedSizeBytes += JSON.stringify(value).length * 2; // Approximate estimation
          } else {
            totalEntries += 1;
            estimatedSizeBytes += JSON.stringify(value).length * 2;
          }
        }
        
        return {
          keys: keys.length,
          totalEntries,
          estimatedSizeMB: estimatedSizeBytes / (1024 * 1024)
        };
      };
    }
  }

  /**
   * Initialize Redis cache if necessary
   */
  async initialize() {
    if (this.useRedis) {
      await this.cache.initialize();
    }
    return this;
  }

  /**
   * Set a value in the cache
   * @param {string} key - Key
   * @param {any} value - Value to store
   * @param {number} ttl - TTL in seconds (optional)
   * @returns {Promise<boolean>} - Success status
   */
  async set(key, value, ttl) {
    return this.cache.set(key, value, ttl || this.ttl);
  }

  /**
   * Get a value from the cache
   * @param {string} key - Key
   * @returns {Promise<any>} - Value or undefined if not exists
   */
  async get(key) {
    return this.cache.get(key);
  }

  /**
   * Delete a key from the cache
   * @param {string} key - Key to delete
   * @returns {Promise<boolean>} - Success status
   */
  async del(key) {
    return this.cache.del(key);
  }

  /**
   * Get all keys in the cache
   * @returns {Promise<string[]>} - List of keys
   */
  async keys() {
    return this.cache.keys();
  }

  /**
   * Get multiple values in a single operation
   * @param {string[]} keys - List of keys
   * @returns {Promise<Object>} - Key/value mapping
   */
  async mget(keys) {
    return this.cache.mget(keys);
  }

  /**
   * Clear the entire cache
   * @returns {Promise<boolean>} - Success status
   */
  async flushAll() {
    return this.cache.flushAll();
  }

  /**
   * Estimate the cache size
   * @returns {Promise<Object>} - Information about cache size
   */
  async estimateSize() {
    return this.cache.estimateSize();
  }

  /**
   * Close the cache connection
   */
  async close() {
    if (this.useRedis) {
      await this.cache.close();
    }
  }
}

module.exports = CacheService;