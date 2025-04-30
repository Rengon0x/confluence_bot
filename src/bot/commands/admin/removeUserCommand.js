// src/bot/commands/admin/removeUserCommand.js
const logger = require('../../../utils/logger');
const betaUserService = require('../../../db/services/betaUserService');

/**
 * Command /removeuser - Admin command to remove a user from the beta users list
 */
const removeUserCommand = {
  name: 'removeuser',
  regex: /\/removeuser(?:@\w+)?\s+(@?\w+)/,
  description: 'Remove a user from the beta users list',
  handler: async (bot, msg, match) => {
    try {
      const chatId = msg.chat.id;
      const username = match[1].trim();
      
      // Direct check for admin access using your actual ID from logs
      // Logs show your ID is 1718036512
      const adminId = '1718036512'; // Rengon0x's actual ID
      
      if (msg.from.id.toString() !== adminId && msg.from.username !== 'Rengon0x') {
        await bot.sendMessage(chatId, "Sorry, only admins can use this command.");
        logger.warn(`User ${msg.from.username} (${msg.from.id}) attempted to use /removeuser but is not admin`);
        return;
      }
      
      // Remove the user from beta users
      const result = await betaUserService.removeBetaUser(username);
      
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
        
        logger.info(`Admin ${msg.from.username || msg.from.id} removed user ${username} from beta users list`);
      } else {
        await bot.sendMessage(chatId, `❌ ${result.message}`);
      }
    } catch (error) {
      logger.error(`Error in removeuser command: ${error.message}`);
      bot.sendMessage(
        msg.chat.id,
        `❌ Error removing user: ${error.message}`
      );
    }
  }
};

module.exports = removeUserCommand;