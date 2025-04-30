// src/bot/commands/admin/listUsersCommand.js
const logger = require('../../../utils/logger');
const betaUserService = require('../../../db/services/betaUserService');
const config = require('../../../config/config');

/**
 * Command /listusers - Admin command to list all beta users
 */
const listUsersCommand = {
  name: 'listusers',
  regex: /\/listusers(?:@\w+)?/,
  description: 'List all beta users',
  handler: async (bot, msg) => {
    try {
      const chatId = msg.chat.id;
      
      // Direct check for admin access using your actual ID from logs
      // Logs show your ID is 1718036512
      const adminId = '1718036512'; // Rengon0x's actual ID
      
      if (msg.from.id.toString() !== adminId && msg.from.username !== 'Rengon0x') {
        await bot.sendMessage(chatId, "Sorry, only admins can use this command.");
        logger.warn(`User ${msg.from.username} (${msg.from.id}) attempted to use /listusers but is not admin`);
        return;
      }
      
      // Get all beta users
      const users = await betaUserService.getAllBetaUsers();
      const availableSpots = await betaUserService.getAvailableSpots();
      const maxUsers = config.accessControl?.maxUsers || 100;
      
      if (users.length === 0) {
        await bot.sendMessage(
          chatId,
          `No beta users found.\n\n` +
          `Available spots: ${availableSpots}/${maxUsers}`
        );
        return;
      }
      
      // Sort users by added date
      users.sort((a, b) => {
        return new Date(a.addedAt) - new Date(b.addedAt);
      });
      
      // Format the user list
      let message = `📋 *Beta Users (${users.length}/${maxUsers})*\n\n`;
      
      for (let i = 0; i < users.length; i++) {
        const user = users[i];
        const addedDate = user.addedAt ? new Date(user.addedAt).toISOString().split('T')[0] : 'Unknown';
        const lastSeen = user.lastSeen ? formatLastSeen(user.lastSeen) : 'Never';
        
        message += `${i + 1}. @${user.username}\n`;
        message += `   Added: ${addedDate} by @${user.addedBy || 'system'}\n`;
        message += `   Last seen: ${lastSeen}\n`;
        
        // Add a separator except for the last user
        if (i < users.length - 1) {
          message += '\n';
        }
        
        // Split message if it's getting too long
        if (message.length > 3500 && i < users.length - 1) {
          await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
          message = `*Beta Users (continued)*\n\n`;
        }
      }
      
      // Add summary
      message += `\n*Summary:*\n`;
      message += `• Total users: ${users.length}\n`;
      message += `• Available spots: ${availableSpots}\n`;
      message += `• Maximum capacity: ${maxUsers}`;
      
      await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      
      logger.info(`Admin ${msg.from.username || msg.from.id} requested beta users list`);
    } catch (error) {
      logger.error(`Error in listusers command: ${error.message}`);
      bot.sendMessage(
        msg.chat.id,
        `❌ Error listing users: ${error.message}`
      );
    }
  }
};

/**
 * Format the "last seen" time in a human-readable format
 * @param {Date|string} date - The date to format
 * @returns {string} Formatted time string
 */
function formatLastSeen(date) {
  const lastSeenDate = new Date(date);
  const now = new Date();
  const diffMs = now - lastSeenDate;
  const diffSeconds = Math.floor(diffMs / 1000);
  
  if (diffSeconds < 60) {
    return 'Just now';
  } else if (diffSeconds < 3600) {
    const minutes = Math.floor(diffSeconds / 60);
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  } else if (diffSeconds < 86400) {
    const hours = Math.floor(diffSeconds / 3600);
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  } else {
    const days = Math.floor(diffSeconds / 86400);
    if (days < 30) {
      return `${days} day${days === 1 ? '' : 's'} ago`;
    } else {
      return lastSeenDate.toISOString().split('T')[0];
    }
  }
}

module.exports = listUsersCommand;