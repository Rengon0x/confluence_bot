// src/bot/commands/user/settingsCommand.js
const db = require('../../../db');
const config = require('../../../config/config');
const logger = require('../../../utils/logger');

/**
 * Commande /settings - Affiche et permet de modifier les paramètres
 */
const settingsCommand = {
  name: 'settings',
  regex: /\/settings(?:@\w+)?/,
  description: 'View and change confluence detection settings',
  handler: async (bot, msg) => {
    // Ne réagir que dans les groupes
    if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') return;
    
    const chatId = msg.chat.id;
    
    // Obtenir les paramètres actuels pour ce groupe
    let settings = await db.getGroupSettings(chatId.toString());
    
    // If no settings exist for this group, create default settings
    if (!settings) {
      // Check if the group exists in the database
      const group = await db.groupService.findByGroupId(chatId.toString());
      
      if (!group) {
        bot.sendMessage(chatId, "No active monitoring found. Use /setup first.");
        return;
      }
      
      // If group exists but settings are null, use defaults
      settings = {
        minWallets: config.confluence.minWallets,
        windowMinutes: config.confluence.windowMinutes
      };
      
      logger.debug(`Using default settings for group ${chatId}: minWallets=${settings.minWallets}, windowMinutes=${settings.windowMinutes}`);
    } else {
      // Even if settings exist, fill in any missing values
      settings.minWallets = settings.minWallets || config.confluence.minWallets;
      settings.windowMinutes = settings.windowMinutes || config.confluence.windowMinutes;
    }
    
    // Créer le clavier de paramètres avec plus d'options
    const keyboard = {
      inline_keyboard: [
        [{
          text: `Min Wallets: ${settings.minWallets}`,
          callback_data: `set_min_wallets`
        }],
        [{
          text: `Time Window: ${settings.windowMinutes} mins`,
          callback_data: `set_time_window`
        }]
      ]
    };
    
    bot.sendMessage(
      chatId,
      "📊 *Confluence Detection Settings*\n\n" +
      `Current configuration:\n` +
      `• Minimum wallets for confluence: ${settings.minWallets}\n` +
      `• Time window: ${settings.windowMinutes} minutes\n\n` +
      `Allowed ranges:\n` +
      `• Min wallets: 2-10\n` +
      `• Time window: 60-2880 minutes (1-48 hours)\n\n` +
      `Select a setting to change:`,
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      }
    );
  }
};

module.exports = settingsCommand;