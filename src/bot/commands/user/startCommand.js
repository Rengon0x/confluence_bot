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
    
    // If it's a group chat
    if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
      bot.sendMessage(
        chatId,
        `👋 Welcome ${firstName}!\n\n` +
        `*What this bot does:*\n` +
        `This bot detects when multiple wallets buy or sell the same token (confluence) and sends alerts to help you spot trending tokens early.\n\n` +
        
        `*Setup this group in 5 easy steps:*\n` +
        `1️⃣ Make sure this bot is an admin in the group\n` +
        `2️⃣ Add our forwarder account @${forwarder1Username} and make it admin\n` +
        `3️⃣ Use the \`/setup\` command\n` +
        `4️⃣ Enter your tracker's username when prompted\n` +
        `5️⃣ Select the tracker type (Cielo, Defined, or Ray)\n\n` +
        
        `*Note:* We recommend also adding our backup forwarder @${forwarder2Username} to your group. ` +
        `This serves as a fallback system if the main forwarder @${forwarder1Username} experiences connectivity issues or becomes temporarily unavailable.\n\n` +
  
        `*Tips:* You can monitor multiple wallet trackers in the same group by using \`/setup\` for each one separately. This increases your chances of finding confluences as the bot combines data from all your trackers!\n\n` +
        
        `Type /help for the complete guide and all available commands.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }
    
    // Private chat message
    bot.sendMessage(
      chatId,
      `👋 Hello ${firstName}!\n\n` +
      `*What this bot does:*\n` +
      `This bot monitors wallet trackers and alerts you when multiple wallets buy or sell the same token within a specific time period (confluence), helping you spot trending tokens early.\n\n` +
      
      `*How to set up:*\n` +
      `1️⃣ Add me to your Telegram group\n` +
      `2️⃣ Add the forwarder @${forwarder1Username} to the same group\n` +
      `3️⃣ Make both of us admins in the group\n` +
      `4️⃣ Type /setup in the group\n` +
      `5️⃣ Follow the prompts to enter your tracker name and select its type\n\n` +
      
      `*Note:* We recommend also adding our backup forwarder @${forwarder2Username} to your group. ` +
      `This serves as a fallback system if the main forwarder @${forwarder1Username} experiences connectivity issues or becomes temporarily unavailable.\n\n` +

      `*Tips:* You can monitor multiple wallet trackers in the same group by using \`/setup\` for each one separately. This increases your chances of finding confluences as the bot combines data from all your trackers!\n\n` +
      
      `Type /help anytime to see the complete guide and all available commands.`,
      { parse_mode: 'Markdown' }
    );
    
    logger.info(`Start command executed by ${msg.from.username || msg.from.first_name} (${msg.from.id}) in ${msg.chat.type} chat`);
  }
};

module.exports = startCommand;