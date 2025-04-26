// src/bot/commands/commandManager.js
const logger = require('../../utils/logger');
const config = require('../../config/config');

/**
 * Classe pour gérer les commandes du bot
 */
class CommandManager {
  constructor() {
    this.commands = new Map();
    this.adminCommands = new Map();
    this.admins = new Set(); // Ensemble des IDs admin
  }

  /**
   * Check if a command is directed at this bot
   * @param {Object} msg - Message object
   * @returns {boolean} - True if the command should be processed
   */
  shouldProcessCommand(msg) {
    if (!msg.text || !msg.text.startsWith('/')) return false;
    
    // Extract command parts
    const commandParts = msg.text.split(' ')[0].split('@');
    const command = commandParts[0];
    const mentionedBot = commandParts[1];
    
    // If no bot is mentioned, process the command
    if (!mentionedBot) return true;
    
    // If a bot is mentioned, only process if it's this bot
    const botUsername = config.telegram.botUsername.replace('@', '');
    return mentionedBot.toLowerCase() === botUsername.toLowerCase();
  }

  /**
   * Ajoute une commande utilisateur
   * @param {Object} command - Objet de commande
   * @param {string} command.name - Nom de la commande (sans le /)
   * @param {RegExp} command.regex - Expression régulière pour matcher la commande
   * @param {Function} command.handler - Fonction de gestion de la commande
   * @param {string} command.description - Description de la commande
   */
  addCommand(command) {
    if (!command.name || !command.regex || !command.handler) {
      logger.error('Invalid command format:', command);
      return;
    }

    this.commands.set(command.name, command);
    logger.debug(`Command registered: ${command.name}`);
  }

  /**
   * Ajoute une commande admin
   * @param {Object} command - Objet de commande admin
   */
  addAdminCommand(command) {
    if (!command.name || !command.regex || !command.handler) {
      logger.error('Invalid admin command format:', command);
      return;
    }

    this.adminCommands.set(command.name, command);
    logger.debug(`Admin command registered: ${command.name}`);
  }

  /**
   * Ajoute plusieurs commandes à la fois
   * @param {Array<Object>} commands - Tableau de commandes
   */
  addCommands(commands) {
    commands.forEach(command => this.addCommand(command));
  }

  /**
   * Ajoute plusieurs commandes admin à la fois
   * @param {Array<Object>} commands - Tableau de commandes admin
   */
  addAdminCommands(commands) {
    commands.forEach(command => this.addAdminCommand(command));
  }

  /**
   * Ajoute un ID utilisateur à la liste des admins
   * @param {string|number} userId - ID Telegram de l'admin
   */
  addAdmin(userId) {
    this.admins.add(userId.toString());
  }

  /**
   * Vérifie si un utilisateur est admin
   * @param {string|number} userId - ID Telegram de l'utilisateur
   * @returns {boolean} True si l'utilisateur est admin
   */
  isAdmin(userId) {
    // Pour le développement, on peut toujours retourner true
    // En production, décommenter la ligne ci-dessous
    // return this.admins.has(userId.toString());
    return true;
  }

  /**
   * Enregistre toutes les commandes auprès du bot Telegram
   * @param {TelegramBot} bot - Instance du bot Telegram
   */
  registerAll(bot) {
    // Enregistrer les commandes utilisateur
    for (const command of this.commands.values()) {
      bot.onText(command.regex, (msg, match) => {
        try {
          // Only process if the command is directed at this bot
          if (!this.shouldProcessCommand(msg)) {
            logger.debug(`Ignoring command ${command.name} directed at another bot`);
            return;
          }
          
          logger.info(`Command ${command.name} executed by user ${msg.from.id}`);
          command.handler(bot, msg, match);
        } catch (error) {
          logger.error(`Error executing command ${command.name}:`, error);
          bot.sendMessage(msg.chat.id, `Error executing command: ${error.message}`);
        }
      });
    }

    // Enregistrer les commandes admin
    for (const command of this.adminCommands.values()) {
      bot.onText(command.regex, (msg, match) => {
        try {
          // Only process if the command is directed at this bot
          if (!this.shouldProcessCommand(msg)) {
            logger.debug(`Ignoring admin command ${command.name} directed at another bot`);
            return;
          }
          
          // Vérifier si l'utilisateur est admin
          if (!this.isAdmin(msg.from.id)) {
            bot.sendMessage(msg.chat.id, "Sorry, only admins can use this command.");
            return;
          }

          logger.info(`Admin command ${command.name} executed by user ${msg.from.id}`);
          command.handler(bot, msg, match);
        } catch (error) {
          logger.error(`Error executing admin command ${command.name}:`, error);
          bot.sendMessage(msg.chat.id, `Error executing command: ${error.message}`);
        }
      });
    }
  }
}

module.exports = new CommandManager();