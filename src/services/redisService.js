const { createClient } = require('redis');
const logger = require('../utils/logger');
const config = require('../config/config');

/**
 * Service Redis pour stocker les données de cache
 * Compatible avec l'API de node-cache pour faciliter la transition
 */
class RedisService {
  constructor(options = {}) {
    this.ttl = options.stdTTL || 3600; // TTL par défaut (en secondes)
    this.prefix = options.prefix || 'bot:';
    this.initialized = false;
    this.client = null;
    this.failoverMode = false;
    this.connectionAttempts = 0;
    this.maxConnectionAttempts = 5;
  }

  /**
   * Initialiser la connexion Redis
   */
  async initialize() {
    if (this.initialized) return;
    
    try {
      if (this.connectionAttempts >= this.maxConnectionAttempts) {
        logger.error(`Trop de tentatives de connexion Redis échouées (${this.connectionAttempts}). Activation du mode failover.`);
        this.failoverMode = true;
        this.fallbackCache = new Map();
        return;
      }

      this.connectionAttempts++;
      
      // Créer le client Redis
      this.client = createClient({
        url: config.redis?.uri || 'redis://localhost:6379',
        socket: {
          reconnectStrategy: (retries) => {
            // Stratégie de backoff exponentiel pour les reconnexions
            const delay = Math.min(retries * 100, 3000);
            return delay;
          }
        }
      });

      // Gestionnaires d'événements
      this.client.on('error', (err) => {
        logger.error(`Erreur Redis: ${err.message}`);
        if (!this.failoverMode && !this.client.isOpen) {
          this.failoverMode = true;
          this.fallbackCache = new Map();
          logger.warn('Mode failover Redis activé - utilisation du cache en mémoire');
        }
      });

      this.client.on('connect', () => {
        logger.info('Connexion Redis établie');
      });

      this.client.on('reconnecting', () => {
        logger.warn('Tentative de reconnexion Redis...');
      });

      this.client.on('ready', () => {
        logger.info('Client Redis prêt');
        this.failoverMode = false;
        this.connectionAttempts = 0;
      });

      // Connecter au serveur Redis
      await this.client.connect();
      
      // Vérifier la connexion
      const ping = await this.client.ping();
      if (ping === 'PONG') {
        logger.info('Redis connecté et fonctionnel');
        this.initialized = true;
      }
    } catch (error) {
      logger.error(`Erreur d'initialisation Redis: ${error.message}`);
      this.failoverMode = true;
      this.fallbackCache = new Map();
      logger.warn('Mode failover Redis activé - utilisation du cache en mémoire');
      
      // Planifier une tentative de reconnexion
      setTimeout(() => {
        logger.info('Tentative de reconnexion Redis...');
        this.initialize().catch(err => {
          logger.error(`Échec de la reconnexion Redis: ${err.message}`);
        });
      }, 5000);
    }
  }

  /**
   * Obtenir une clé préfixée
   * @param {string} key - Clé originale
   * @returns {string} - Clé préfixée
   */
  getFullKey(key) {
    return `${this.prefix}${key}`;
  }

  /**
   * Définir une valeur dans le cache
   * @param {string} key - Clé
   * @param {any} value - Valeur à stocker (sera sérialisée en JSON)
   * @param {number} ttl - TTL en secondes (optionnel)
   * @returns {boolean} - Succès de l'opération
   */
  async set(key, value, ttl) {
    try {
      if (this.failoverMode) {
        // Mode failover - utiliser le cache en mémoire
        this.fallbackCache.set(key, {
          value,
          expires: ttl ? Date.now() + (ttl * 1000) : 0
        });
        return true;
      }

      if (!this.initialized) {
        await this.initialize();
      }
      
      const fullKey = this.getFullKey(key);
      const serializedValue = JSON.stringify(value);
      
      // Définir avec ou sans TTL
      if (ttl) {
        await this.client.setEx(fullKey, ttl, serializedValue);
      } else if (this.ttl) {
        await this.client.setEx(fullKey, this.ttl, serializedValue);
      } else {
        await this.client.set(fullKey, serializedValue);
      }
      
      return true;
    } catch (error) {
      logger.error(`Erreur Redis set(${key}): ${error.message}`);
      
      // Fallback en cas d'erreur
      if (!this.failoverMode) {
        this.failoverMode = true;
        this.fallbackCache = new Map();
        logger.warn('Mode failover Redis activé en raison d\'une erreur');
        
        // Réessayer en mode failover
        return this.set(key, value, ttl);
      }
      
      return false;
    }
  }

  /**
   * Récupérer une valeur du cache
   * @param {string} key - Clé
   * @returns {any} - Valeur désérialisée ou undefined si inexistante
   */
  async get(key) {
    try {
      if (this.failoverMode) {
        // Mode failover - utiliser le cache en mémoire
        const item = this.fallbackCache.get(key);
        if (!item) return undefined;
        
        // Vérifier si expiré
        if (item.expires && item.expires < Date.now()) {
          this.fallbackCache.delete(key);
          return undefined;
        }
        
        return item.value;
      }

      if (!this.initialized) {
        await this.initialize();
      }
      
      const fullKey = this.getFullKey(key);
      const value = await this.client.get(fullKey);
      
      if (!value) return undefined;
      
      try {
        return JSON.parse(value);
      } catch (parseError) {
        logger.warn(`Erreur de parsing JSON pour la clé ${key}: ${parseError.message}`);
        return undefined;
      }
    } catch (error) {
      logger.error(`Erreur Redis get(${key}): ${error.message}`);
      
      // Fallback en cas d'erreur
      if (!this.failoverMode) {
        this.failoverMode = true;
        this.fallbackCache = new Map();
        logger.warn('Mode failover Redis activé en raison d\'une erreur');
      }
      
      return undefined;
    }
  }

  /**
   * Supprimer une clé du cache
   * @param {string} key - Clé à supprimer
   * @returns {boolean} - Succès de l'opération
   */
  async del(key) {
    try {
      if (this.failoverMode) {
        // Mode failover - utiliser le cache en mémoire
        return this.fallbackCache.delete(key);
      }

      if (!this.initialized) {
        await this.initialize();
      }
      
      const fullKey = this.getFullKey(key);
      await this.client.del(fullKey);
      return true;
    } catch (error) {
      logger.error(`Erreur Redis del(${key}): ${error.message}`);
      
      // Fallback en cas d'erreur
      if (!this.failoverMode) {
        this.failoverMode = true;
        this.fallbackCache = new Map();
        logger.warn('Mode failover Redis activé en raison d\'une erreur');
        
        // Réessayer en mode failover
        return this.del(key);
      }
      
      return false;
    }
  }

  /**
   * Obtenir toutes les clés dans le cache
   * @returns {string[]} - Liste des clés
   */
  async keys() {
    try {
      if (this.failoverMode) {
        // Mode failover - utiliser le cache en mémoire
        return Array.from(this.fallbackCache.keys());
      }

      if (!this.initialized) {
        await this.initialize();
      }
      
      const pattern = `${this.prefix}*`;
      const keys = await this.client.keys(pattern);
      
      // Retirer le préfixe des clés
      return keys.map(key => key.substring(this.prefix.length));
    } catch (error) {
      logger.error(`Erreur Redis keys(): ${error.message}`);
      
      // Fallback en cas d'erreur
      if (!this.failoverMode) {
        this.failoverMode = true;
        this.fallbackCache = new Map();
        logger.warn('Mode failover Redis activé en raison d\'une erreur');
        
        // Réessayer en mode failover
        return this.keys();
      }
      
      return [];
    }
  }

  /**
   * Obtenir plusieurs valeurs en une seule opération
   * @param {string[]} keys - Liste des clés
   * @returns {Object} - Mapping clé/valeur
   */
  async mget(keys) {
    try {
      if (this.failoverMode) {
        // Mode failover - utiliser le cache en mémoire
        const result = {};
        
        for (const key of keys) {
          const item = this.fallbackCache.get(key);
          if (item && (!item.expires || item.expires > Date.now())) {
            result[key] = item.value;
          }
        }
        
        return result;
      }

      if (!this.initialized) {
        await this.initialize();
      }
      
      if (keys.length === 0) return {};
      
      const fullKeys = keys.map(key => this.getFullKey(key));
      const values = await this.client.mGet(fullKeys);
      
      const result = {};
      
      for (let i = 0; i < keys.length; i++) {
        if (values[i]) {
          try {
            result[keys[i]] = JSON.parse(values[i]);
          } catch (parseError) {
            logger.warn(`Erreur de parsing JSON pour la clé ${keys[i]}: ${parseError.message}`);
          }
        }
      }
      
      return result;
    } catch (error) {
      logger.error(`Erreur Redis mget(): ${error.message}`);
      
      // Fallback en cas d'erreur
      if (!this.failoverMode) {
        this.failoverMode = true;
        this.fallbackCache = new Map();
        logger.warn('Mode failover Redis activé en raison d\'une erreur');
        
        // Réessayer en mode failover
        return this.mget(keys);
      }
      
      return {};
    }
  }

  /**
   * Vider complètement le cache
   */
  async flushAll() {
    try {
      if (this.failoverMode) {
        // Mode failover - utiliser le cache en mémoire
        this.fallbackCache.clear();
        return true;
      }

      if (!this.initialized) {
        await this.initialize();
      }
      
      // Supprimer uniquement les clés avec notre préfixe pour ne pas affecter d'autres applications
      const pattern = `${this.prefix}*`;
      const keys = await this.client.keys(pattern);
      
      if (keys.length > 0) {
        await this.client.del(keys);
      }
      
      return true;
    } catch (error) {
      logger.error(`Erreur Redis flushAll(): ${error.message}`);
      
      // Fallback en cas d'erreur
      if (!this.failoverMode) {
        this.failoverMode = true;
        this.fallbackCache = new Map();
        logger.warn('Mode failover Redis activé en raison d\'une erreur');
        
        // Réessayer en mode failover
        return this.flushAll();
      }
      
      return false;
    }
  }

  /**
   * Estimer la taille du cache
   */
  async estimateSize() {
    try {
      if (this.failoverMode) {
        // Mode failover - estimer la taille du cache en mémoire
        let totalSize = 0;
        let totalEntries = this.fallbackCache.size;
        
        for (const [key, item] of this.fallbackCache.entries()) {
          // Estimation approximative de la taille
          const keySize = key.length * 2; // 2 octets par caractère
          const valueSize = JSON.stringify(item.value).length * 2;
          totalSize += keySize + valueSize;
        }
        
        const sizeMB = totalSize / (1024 * 1024);
        
        return {
          keys: totalEntries,
          totalEntries,
          estimatedSizeMB: sizeMB
        };
      }

      if (!this.initialized) {
        await this.initialize();
      }
      
      const pattern = `${this.prefix}*`;
      const keys = await this.client.keys(pattern);
      
      let totalSize = 0;
      let totalEntries = 0;
      
      // Obtenir les informations de taille pour chaque clé
      for (const key of keys) {
        const type = await this.client.type(key);
        
        if (type === 'string') {
          const size = await this.client.memoryUsage(key);
          totalSize += size;
          
          // Compter le nombre d'entrées
          const value = await this.client.get(key);
          try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) {
              totalEntries += parsed.length;
            } else {
              totalEntries += 1;
            }
          } catch {
            totalEntries += 1;
          }
        }
      }
      
      const sizeMB = totalSize / (1024 * 1024);
      
      return {
        keys: keys.length,
        totalEntries,
        estimatedSizeMB: sizeMB
      };
    } catch (error) {
      logger.error(`Erreur Redis estimateSize(): ${error.message}`);
      
      // Fallback en cas d'erreur
      if (!this.failoverMode) {
        this.failoverMode = true;
        this.fallbackCache = new Map();
        logger.warn('Mode failover Redis activé en raison d\'une erreur');
        
        // Réessayer en mode failover
        return this.estimateSize();
      }
      
      return {
        keys: 0,
        totalEntries: 0,
        estimatedSizeMB: 0
      };
    }
  }

  /**
   * Fermer la connexion Redis
   */
  async close() {
    if (!this.failoverMode && this.client) {
      try {
        await this.client.quit();
        logger.info('Connexion Redis fermée proprement');
      } catch (error) {
        logger.error(`Erreur lors de la fermeture de Redis: ${error.message}`);
      }
    }
    
    this.initialized = false;
  }
}

module.exports = RedisService;