// src/bot/commands/user/startCommand.js
const config = require('../../../config/config');
const logger = require('../../../utils/logger');

const startCommand = {
  name: 'start',
  regex: /\/start/,
  description: 'Start the bot in private chat or group',
  handler: async (bot, msg) => {
    const chatId = msg.chat.id;
    const firstName = msg.from.first_name;
    
    // Get forwarder usernames from config
    const forwarder1Username = config.telegram.forwarders?.[0]?.forwarderUsername || 'YourForwarderUsername';
    const forwarder2Username = config.telegram.forwarders?.[1]?.forwarderUsername || 'YourBackupForwarderUsername';
    
    // Create explanation button
    const explainButton = {
      inline_keyboard: [[{
        text: "❓ Why do I need to add forwarder accounts?",
        callback_data: "explain_forwarders"
      }]]
    };
    
    // If it's a group chat
    if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
      bot.sendMessage(
        chatId,
        `👋 Hello ${firstName}!\n\n` +
        `*What this bot does:*\n` +
        `I detect when multiple wallets buy or sell the same cryptocurrency within a set time period (confluence), helping you spot trending tokens early.\n\n` +
        
        `*Quick setup:*\n` +
        `1️⃣ Make me an admin in this group\n` +
        `2️⃣ Add @${forwarder1Username} and make it admin\n` +
        `3️⃣ Type /setup and follow the prompts\n\n` +
        
        `*Recommended:* Also add @${forwarder2Username} as admin (backup system).\n\n` +
        
        `Type /help for all available commands.`,
        { 
          parse_mode: 'Markdown',
          reply_markup: explainButton
        }
      );
      return;
    }
    
    // Private chat message
    bot.sendMessage(
      chatId,
      `👋 Hello ${firstName}!\n\n` +
      `*What this bot does:*\n` +
      `I monitor wallet trackers and alert you when multiple wallets buy or sell the same cryptocurrency within a specific time period (confluence), helping you spot trending tokens early.\n\n` +
      
      `*Setup in 3 steps:*\n` +
      `1️⃣ Add me to your Telegram group\n` +
      `2️⃣ Add @${forwarder1Username} to the group and make both of us admins\n` +
      `3️⃣ Type /setup in the group\n\n` +
      
      `*Recommended:* Also add @${forwarder2Username} as admin (backup system).\n\n` +
      
      `*Tip:* You can monitor multiple trackers in the same group for more data!\n\n` +
      
      `Type /help for all available commands.`,
      { 
        parse_mode: 'Markdown',
        reply_markup: explainButton
      }
    );
    
    logger.info(`Start command executed by ${msg.from.username || msg.from.first_name} (${msg.from.id}) in ${msg.chat.type} chat`);
  }
};

module.exports = startCommand;