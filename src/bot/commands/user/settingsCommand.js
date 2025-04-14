// src/bot/commands/user/settingsCommand.js
const db = require('../../../db');

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
    const settings = await db.getGroupSettings(chatId.toString());
    
    if (!settings) {
      bot.sendMessage(chatId, "No active monitoring found. Use /setup first.");
      return;
    }
    
    // Créer le clavier de paramètres
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
      `Select a setting to change:`,
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      }
    );
  }
};

module.exports = settingsCommand;