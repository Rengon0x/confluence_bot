const NodeCache = require('node-cache');
const RedisService = require('./redisService');
const config = require('../config/config');
const logger = require('../utils/logger');

/**
 * Service de cache unifié qui utilise soit Redis, soit NodeCache
 * Fournit une API unifiée indépendante de l'implémentation sous-jacente
 */
class CacheService {
  constructor(options = {}) {
    this.useRedis = config.redis.enabled;
    this.prefix = options.prefix || '';
    this.ttl = options.stdTTL || (config.confluence.windowMinutes * 60); // TTL par défaut en secondes
    
    // Initialiser le cache approprié
    if (this.useRedis) {
      logger.info(`Initialisation du cache Redis avec préfixe '${this.prefix}'`);
      this.cache = new RedisService({
        stdTTL: this.ttl,
        prefix: this.prefix
      });
    } else {
      logger.info(`Initialisation du cache local (NodeCache) avec TTL de ${this.ttl} secondes`);
      this.cache = new NodeCache({
        stdTTL: this.ttl,
        checkperiod: Math.min(this.ttl / 10, 600),
        useClones: false  // Pour des performances optimales
      });
      
      // Adapter l'API de NodeCache pour être compatible avec Redis
      this.originalGet = this.cache.get.bind(this.cache);
      this.originalSet = this.cache.set.bind(this.cache);
      this.originalDel = this.cache.del.bind(this.cache);
      this.originalKeys = this.cache.keys.bind(this.cache);
      this.originalFlushAll = this.cache.flushAll.bind(this.cache);
      
      // Surcharger les méthodes pour fournir une API compatible Promise
      this.cache.get = async (key) => this.originalGet(key);
      this.cache.set = async (key, value, ttl) => this.originalSet(key, value, ttl);
      this.cache.del = async (key) => this.originalDel(key);
      this.cache.keys = async () => this.originalKeys();
      this.cache.flushAll = async () => this.originalFlushAll();
      
      // Ajouter l'API mget manquante
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
      
      // Ajouter l'API pour estimer la taille
      this.cache.estimateSize = async () => {
        const keys = this.originalKeys();
        let totalEntries = 0;
        let estimatedSizeBytes = 0;
        
        for (const key of keys) {
          const value = this.originalGet(key);
          if (Array.isArray(value)) {
            totalEntries += value.length;
            estimatedSizeBytes += JSON.stringify(value).length * 2; // Estimation approximative
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
   * Initialiser le cache Redis si nécessaire
   */
  async initialize() {
    if (this.useRedis) {
      await this.cache.initialize();
    }
    return this;
  }

  /**
   * Définir une valeur dans le cache
   * @param {string} key - Clé
   * @param {any} value - Valeur à stocker
   * @param {number} ttl - TTL en secondes (optionnel)
   * @returns {Promise<boolean>} - Succès de l'opération
   */
  async set(key, value, ttl) {
    return this.cache.set(key, value, ttl || this.ttl);
  }

  /**
   * Récupérer une valeur du cache
   * @param {string} key - Clé
   * @returns {Promise<any>} - Valeur ou undefined si inexistante
   */
  async get(key) {
    return this.cache.get(key);
  }

  /**
   * Supprimer une clé du cache
   * @param {string} key - Clé à supprimer
   * @returns {Promise<boolean>} - Succès de l'opération
   */
  async del(key) {
    return this.cache.del(key);
  }

  /**
   * Obtenir toutes les clés dans le cache
   * @returns {Promise<string[]>} - Liste des clés
   */
  async keys() {
    return this.cache.keys();
  }

  /**
   * Obtenir plusieurs valeurs en une seule opération
   * @param {string[]} keys - Liste des clés
   * @returns {Promise<Object>} - Mapping clé/valeur
   */
  async mget(keys) {
    return this.cache.mget(keys);
  }

  /**
   * Vider complètement le cache
   * @returns {Promise<boolean>} - Succès de l'opération
   */
  async flushAll() {
    return this.cache.flushAll();
  }

  /**
   * Estimer la taille du cache
   * @returns {Promise<Object>} - Informations sur la taille du cache
   */
  async estimateSize() {
    return this.cache.estimateSize();
  }

  /**
   * Fermer la connexion au cache
   */
  async close() {
    if (this.useRedis) {
      await this.cache.close();
    }
  }
}

module.exports = CacheService;