// src/middlewares/accessControlMiddleware.js
const logger = require('../utils/logger');
const betaUserService = require('../db/services/betaUserService');
const config = require('../config/config');

/**
 * Middleware to check if a user is authorized to use the bot
 * @param {TelegramBot} bot - The Telegram bot instance
 */
function setupAccessControlMiddleware(bot) {
  // Store the original onText method
  const originalOnText = bot.onText;
  
  // Override the onText method to intercept all command registration
  bot.onText = function(regexp, callback) {
    // Replace the callback with our own that checks authentication
    return originalOnText.call(this, regexp, async (msg, match) => {
      // Log all commands for debugging
      logger.info(`Command intercepted: ${msg.text} from user @${msg.from.username || 'unknown'} (${msg.from.id}) in ${msg.chat.type}`);
      
      // Always allow /start and /help
      if (msg.text && (msg.text.startsWith('/start') || msg.text.startsWith('/help'))) {
        logger.info(`onText: Allowing unrestricted access to ${msg.text}`);
        return callback(msg, match);
      }
      
      // Handle admin commands
      const isAdminCommand = msg.text && (
        msg.text.startsWith('/adduser') || 
        msg.text.startsWith('/removeuser') || 
        msg.text.startsWith('/listusers')
      );
      
      if (isAdminCommand) {
        // Log all relevant information for debugging admin check
        logger.info(`Admin check - User ID: ${msg.from.id}, Admin IDs: ${JSON.stringify(config.adminUsers)}`);
        
        // Directly check if this is the specific admin user ID - from logs it's 1718036512
        const isAdmin = msg.from.id.toString() === '1718036512';
        
        // Provide a backup path for username check
        const isRengon = (msg.from.username && msg.from.username === 'Rengon0x');
        
        if (isAdmin || isRengon) {
          logger.info(`onText: Admin ${msg.from.username} (${msg.from.id}) using command ${msg.text}`);
          return callback(msg, match);
        } else {
          logger.warn(`onText: Non-admin ${msg.from.username} (${msg.from.id}) tried to use admin command ${msg.text}`);
          await this.sendMessage(msg.chat.id, "⛔ You don't have permission to use admin commands.");
          return; // Don't execute the command
        }
      }
      
      // IMPORTANT: Check if this is a group chat - groups have different rules
      if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
        // For group chats, we need to check if the user is either:
        // 1. A group admin OR
        // 2. An authorized beta user
        
        try {
          // First check if user is a group admin
          const chatMember = await this.getChatMember(msg.chat.id, msg.from.id);
          const isGroupAdmin = chatMember && ['creator', 'administrator'].includes(chatMember.status);
          
          if (isGroupAdmin) {
            logger.info(`onText: Group admin ${msg.from.username} allowed to use ${msg.text} in group ${msg.chat.title}`);
            return callback(msg, match); // Allow group admins to use commands
          }
          
          // Not a group admin, check if they're in the beta whitelist
          const isAuthorized = await betaUserService.isUserAuthorized(msg.from);
          
          if (isAuthorized) {
            logger.info(`onText: Authorized user ${msg.from.username} using ${msg.text} in group ${msg.chat.title}`);
            await betaUserService.updateUserInfo(msg.from);
            return callback(msg, match); // Execute the command
          } else {
            // Neither a group admin nor a whitelisted user
            logger.info(`onText: Unauthorized user ${msg.from.username} blocked from using ${msg.text} in group ${msg.chat.title}`);
            await handleUnauthorizedAccess(this, msg);
            return; // Don't execute the command
          }
        } catch (error) {
          logger.error(`Error checking group permissions: ${error.message}`);
          // If we can't determine permissions, default to checking whitelist
          const isAuthorized = await betaUserService.isUserAuthorized(msg.from);
          
          if (isAuthorized) {
            return callback(msg, match);
          } else {
            await handleUnauthorizedAccess(this, msg);
            return;
          }
        }
      } else {
        // For private chats, just check the beta whitelist
        const isAuthorized = await betaUserService.isUserAuthorized(msg.from);
        
        if (isAuthorized) {
          logger.info(`onText: Authorized user ${msg.from.username} using command ${msg.text} in private chat`);
          await betaUserService.updateUserInfo(msg.from);
          return callback(msg, match); // Execute the command
        } else {
          logger.info(`onText: Unauthorized user ${msg.from.username} blocked from using ${msg.text} in private chat`);
          await handleUnauthorizedAccess(this, msg);
          return; // Don't execute the command
        }
      }
    });
  };
  
  // We're only using onText interception now, not emit interception
  logger.info('Access control middleware set up using onText interception');
  logger.info('Access control middleware has been set up');
}

/**
 * Handle unauthorized access attempt
 * @param {TelegramBot} bot - The Telegram bot instance
 * @param {Object} msg - Telegram message
 */
async function handleUnauthorizedAccess(bot, msg) {
  try {
    // Get available spots count
    const availableSpots = await betaUserService.getAvailableSpots();
    const currentUsers = await betaUserService.getBetaUserCount();
    const maxUsers = config.accessControl?.maxUsers || 100;
    const contactUser = config.accessControl?.contactUser || 'rengon0x';
    
    // Create response message with available spots
    const response = `🔒 *Access Restricted*\n\n` +
      `Thank you for your interest in Noesis Conflux!\n\n` +
      `Our bot is currently in beta with limited access. There are currently ` +
      `*${currentUsers}/${maxUsers}* spots filled with ` +
      `*${availableSpots}* spots available.\n\n` +
      `To request access, please contact @${contactUser} with your Telegram username ` +
      `and a brief explanation of how you plan to use the bot.\n\n` +
      `We appreciate your understanding as we scale our service carefully.`;
    
    // Send the message
    await bot.sendMessage(msg.chat.id, response, { parse_mode: 'Markdown' });
    
    // Log the access attempt
    logger.info(`Access attempt by unauthorized user: @${msg.from.username || 'unknown'} (${msg.from.id})`);
  } catch (error) {
    logger.error(`Error handling unauthorized access: ${error.message}`);
  }
}

module.exports = setupAccessControlMiddleware;