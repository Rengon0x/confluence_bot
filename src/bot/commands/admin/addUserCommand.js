// src/bot/commands/admin/addUserCommand.js
const logger = require('../../../utils/logger');
const betaUserService = require('../../../db/services/betaUserService');

/**
 * Command /adduser - Admin command to add a user to the beta users list
 */
const addUserCommand = {
  name: 'adduser',
  regex: /\/adduser(?:@\w+)?\s+(@?\w+)/,
  description: 'Add a user to the beta users list',
  handler: async (bot, msg, match) => {
    try {
      const chatId = msg.chat.id;
      const username = match[1].trim();
      
      // Direct check for admin access using your actual ID from logs
      // Logs show your ID is 1718036512
      const adminId = '1718036512'; // Rengon0x's actual ID
      
      if (msg.from.id.toString() !== adminId && msg.from.username !== 'Rengon0x') {
        await bot.sendMessage(chatId, "Sorry, only admins can use this command.");
        logger.warn(`User ${msg.from.username} (${msg.from.id}) attempted to use /adduser but is not admin`);
        return;
      }
      
      // Add the user to beta users
      const result = await betaUserService.addBetaUser(
        username, 
        msg.from.username || `user_${msg.from.id}`
      );
      
      if (result.success) {
        // Get current user count and available spots
        const currentUsers = await betaUserService.getBetaUserCount();
        const availableSpots = await betaUserService.getAvailableSpots();
        const maxUsers = require('../../../config/config').accessControl?.maxUsers || 100;
        
        await bot.sendMessage(
          chatId,
          `✅ ${result.message}\n\n` +
          `Current authorized users: ${currentUsers}/${maxUsers}\n` +
          `Available spots: ${availableSpots}`
        );
        
        logger.info(`Admin ${msg.from.username || msg.from.id} added user ${username} to beta users list`);
      } else {
        await bot.sendMessage(chatId, `❌ ${result.message}`);
      }
    } catch (error) {
      logger.error(`Error in adduser command: ${error.message}`);
      bot.sendMessage(
        msg.chat.id,
        `❌ Error adding user: ${error.message}`
      );
    }
  }
};

module.exports = addUserCommand;