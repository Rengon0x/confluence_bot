const logger = require('../utils/logger');
const config = require('../config/config');
const db = require('../db');
const confluenceService = require('../services/confluenceService')
const Transaction = require('../models/transaction');
const telegramService = require('../services/telegramService');

/**
 * Register all command handlers for the bot
 * @param {TelegramBot} bot - The Telegram bot instance
 */
function registerCommands(bot) {
  /**
   * Handle /start command (private chat)
   */
  console.log("RegisterCommands initialized");

  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const firstName = msg.from.first_name;
    
    // Check if it's a group chat
    if (msg.chat.type !== 'private') {
      // Inform the user to use the command in private chat
      bot.sendMessage(
        chatId,
        `Hi ${firstName}! The /start command is meant to be used in a private chat. Please message me directly @${config.telegram.botUsername} and send /start there to configure the bot properly.`
      );
      return;
    }
    
    // Original private chat functionality
    bot.sendMessage(
      chatId,
      `👋 Hi ${firstName}! I can detect when multiple wallets buy or sell the same coin.\n\n` +
      `Please enter the username of your wallet tracker (with @ symbol), for example:\n` +
      `@CieloTrackerPrivate_bot`
    );
  });
  
  /**
   * Handle /setup command (in groups)
   */
  bot.onText(/\/setup(?:@\w+)?(?:\s+(.+))?/, async (msg, match) => {
    // Only respond in groups
    if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') {
      bot.sendMessage(msg.chat.id, "This command can only be used in groups. Please add me to a group first.");
      return;
    }
    
    const chatId = msg.chat.id;
    const chatName = msg.chat.title;
    
    // Check if tracker was specified in command
    let trackerName = match && match[1] ? match[1].trim() : null;
    
    if (!trackerName) {
      // If no tracker specified, prompt them to specify one
      bot.sendMessage(
        chatId,
        "Please specify which tracker bot to monitor. For example:\n" +
        `/setup CieloTrackerPrivate`
      );
      return;
    }
    
    // Clean up tracker name format
    trackerName = trackerName.replace(/^@/, '');
    
    // Register this group for tracking the specified tracker
    try {
      // Register the tracking setup in the database
      const success = await db.registerTracking(trackerName, chatId.toString(), chatName);
      
      if (success) {
        bot.sendMessage(
          chatId,
          `✅ Setup complete! I'm now monitoring *${trackerName}* in this group.\n\n` +
          `I'll alert you when multiple wallets buy or sell the same coin.\n\n` +
          `Default settings:\n` +
          `• Minimum wallets for confluence: ${config.confluence.minWallets}\n` +
          `• Time window: ${config.confluence.windowMinutes} minutes\n\n` +
          `You can change these with /settings`,
          { parse_mode: 'Markdown' }
        );
      } else {
        bot.sendMessage(
          chatId,
          `❌ Setup failed. Please try again or contact support.`
        );
      }
    } catch (error) {
      logger.error('Error in setup command:', error);
      bot.sendMessage(
        chatId,
        `❌ Setup failed: ${error.message}\n\nPlease try again or contact support.`
      );
    }
  });
  
  /**
   * Handle /stop command (in groups)
   */
  bot.onText(/\/stop/, async (msg) => {
    // Only respond in groups
    if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') return;
    
    const chatId = msg.chat.id;
    const chatName = msg.chat.title;
    
    // Get all trackers for this group
    const trackers = await db.getGroupTrackers(chatId.toString());
    
    if (!trackers || trackers.length === 0) {
      bot.sendMessage(
        chatId,
        "No active monitoring found in this group. Use /setup to start monitoring."
      );
      return;
    }
    
    // Remove all trackers
    let allRemoved = true;
    for (const tracker of trackers) {
      const success = await db.removeTracking(tracker.trackerName, chatId.toString());
      if (!success) allRemoved = false;
    }
    
    if (allRemoved) {
      bot.sendMessage(
        chatId,
        "🛑 All monitoring has been deactivated in this group.\n" +
        "To reactivate, use the /setup command with a tracker name."
      );
      logger.info(`Monitoring deactivated in group: ${chatName} (${chatId})`);
    } else {
      bot.sendMessage(
        chatId,
        "⚠️ Some trackers could not be removed. Please try again or use /remove for specific trackers."
      );
    }
  });
  
  /**
   * Handle /settings command (in groups)
   */
  bot.onText(/\/settings(?:@\w+)?/, async (msg) => {
    // Only respond in groups
    if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') return;
    
    const chatId = msg.chat.id;
    
    // Get current settings for this group
    const settings = await db.getGroupSettings(chatId.toString());
    
    if (!settings) {
      bot.sendMessage(chatId, "No active monitoring found. Use /setup first.");
      return;
    }
    
    // Create settings keyboard
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
  });
  
  /**
   * Handle /status command (in groups)
   */
  bot.onText(/\/status(?:@\w+)?/, async (msg) => {
    // Only respond in groups
    if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') return;
    
    const chatId = msg.chat.id;
    
    // Get tracking status for this group
    const trackers = await db.getGroupTrackers(chatId.toString());
    
    if (!trackers || trackers.length === 0) {
      bot.sendMessage(chatId, "No active monitoring found. Use /setup to get started.");
      return;
    }
    
    // Format a list of all trackers being monitored
    const trackerList = trackers.map(t => 
      `• *${t.trackerName}*: ${t.active ? '✅ Active' : '❌ Inactive'}`
    ).join('\n');
    
    bot.sendMessage(
      chatId,
      "📊 *Monitoring Status*\n\n" +
      `This group is monitoring the following trackers:\n${trackerList}\n\n` +
      `Use /settings to view or change settings.`,
      { parse_mode: 'Markdown' }
    );
  });
  
  /**
   * Handle /remove command (in groups)
   */
  bot.onText(/\/remove(?:@\w+)?\s+(.+)/, async (msg, match) => {
    // Only respond in groups
    if (msg.chat.type !== 'group' && msg.chat.type !== 'supergroup') return;
    
    const chatId = msg.chat.id;
    const trackerName = match[1].trim().replace(/^@/, '');
    
    // Remove the tracker from monitoring
    const success = await db.removeTracking(trackerName, chatId.toString());
    
    if (success) {
      bot.sendMessage(
        chatId,
        `✅ Stopped monitoring *${trackerName}* in this group.`,
        { parse_mode: 'Markdown' }
      );
    } else {
      bot.sendMessage(
        chatId,
        `❌ Error: *${trackerName}* is not being monitored in this group.`,
        { parse_mode: 'Markdown' }
      );
    }
  });

  /**
   * Handle /debug command admin only (debug + token address)
   */
  bot.onText(/\/debug\s+(.+)/, async (msg, match) => {
    // Vérifiez si l'utilisateur est autorisé (par exemple, s'il est admin du groupe)
    const chatId = msg.chat.id;
    const token = match[1].trim();
    
    if (!token) {
      bot.sendMessage(chatId, "Please specify a token symbol or address to debug");
      return;
    }
    
    logger.info(`Debug request for token: ${token} by user ${msg.from.id}`);
    confluenceService.findTransactionsForToken(token);
    bot.sendMessage(chatId, "Debug info written to logs. Check your server console or log files.");
  });

    /**
     * Handle /cache command admin only (inspect cache)
     */
  bot.onText(/\/cache/, async (msg) => {
    const chatId = msg.chat.id;
    
    // Appeler la méthode de diagnostic
    confluenceService.dumpTransactionsCache();
    
    // Récupérer quelques statistiques de base pour l'utilisateur
    const keys = confluenceService.transactionsCache.keys();
    const totalTransactions = keys.reduce((sum, key) => {
      const transactions = confluenceService.transactionsCache.get(key) || [];
      return sum + transactions.length;
    }, 0);
    
    const cacheStats = confluenceService.estimateCacheSize(); // Méthode à implémenter
    
    bot.sendMessage(chatId, 
      `Cache diagnosis written to logs.\n` +
      `Total keys in cache: ${keys.length}\n` +
      `Total transactions: ${totalTransactions}\n` +
      `Estimated cache size: ${cacheStats.estimatedSizeMB.toFixed(2)}MB`
    );
  });

  // In commands.js

// Command to simulate transactions that will create a confluence
bot.onText(/\/simulate(?:\s+(\d+))?(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const walletCount = parseInt(match[1] || "2", 10); // Number of wallets, default is 2
    const coinName = (match[2] || "TESTTOK").toUpperCase(); // Token name, default is TESTTOK
    
    // Check permission (optional)
    if (!isAdmin(msg.from.id)) {
      bot.sendMessage(chatId, "Sorry, only admins can use simulation commands.");
      return;
    }
  
    try {
      // Track if confluence is detected
      let confluenceDetected = false;
      
      // Create a fictional token ID
      const coinAddress = `SIM${Date.now().toString(36).slice(-6)}`;
      
      // Generate transactions for multiple wallets
      for (let i = 1; i <= walletCount; i++) {
        // Create a fictional wallet
        const walletName = `TestWallet${i}`;
        
        // Create a transaction
        const transaction = new Transaction(
          walletName,
          'buy', // Always buys for simulation
          coinName,
          coinAddress,
          Math.floor(Math.random() * 1000000) + 100000, // Random amount between 100k and 1.1M
          Math.floor(Math.random() * 1000) + 100, // Random USD value between $100 and $1100
          new Date(),
          Math.floor(Math.random() * 100000) + 10000 // Random MarketCap between $10k and $110k
        );
        
        // Inject the transaction into the system
        await confluenceService.addTransaction(transaction, chatId.toString());
        
        // Log the simulation
        logger.info(`Simulated transaction: ${walletName} bought ${transaction.amount} ${coinName} (${coinAddress})`);
        
        // Send a confirmation message for the transaction
        bot.sendMessage(
          chatId,
          `🧪 <b>Simulated transaction #${i}:</b>\n` +
          `Wallet: <code>${walletName}</code>\n` +
          `Action: BUY\n` +
          `Token: ${coinName} (${coinAddress.substring(0, 8)})\n` +
          `Amount: ${transaction.amount.toLocaleString()}\n` +
          `USD Value: $${transaction.usdValue.toLocaleString()}`,
          { parse_mode: 'HTML' }
        );
        
        // After each transaction, check if a confluence is detected
        const confluences = confluenceService.checkConfluences(chatId.toString());
        
        if (confluences && confluences.length > 0) {
          confluenceDetected = true;
          
          // Send a message to the group
          for (const confluence of confluences) {
            const formattedMessage = telegramService.formatConfluenceMessage(confluence);
            bot.sendMessage(chatId, formattedMessage, { parse_mode: 'HTML' });
          }
        }
        
        // Wait a bit between transactions to simulate separate purchases
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      // If no confluence was detected after all transactions
      if (!confluenceDetected) {
        bot.sendMessage(
          chatId,
          `⚠️ All ${walletCount} transactions processed but no confluence was detected!`,
          { parse_mode: 'HTML' }
        );
        
        // Dump transactions for debugging
        confluenceService.findTransactionsForToken(coinName);
        confluenceService.findTransactionsForToken(coinAddress);
      }
      
    } catch (error) {
      logger.error(`Error in simulation: ${error.message}`);
      bot.sendMessage(
        chatId,
        `❌ Error during simulation: ${error.message}`,
        { parse_mode: 'HTML' }
      );
    }
  });
  
  // Command to simulate a predefined confluence (can be useful for quick testing)
  bot.onText(/\/quicksim/, async (msg) => {
    const chatId = msg.chat.id;
    
    // Check permission (optional)
    if (!isAdmin(msg.from.id)) {
      bot.sendMessage(chatId, "Sorry, only admins can use simulation commands.");
      return;
    }
    
    try {
      // Create a fictional token ID and name
      const coinName = `QTEST${Date.now().toString(36).slice(-4).toUpperCase()}`;
      const coinAddress = `QSIM${Date.now().toString(36).slice(-6)}`;
      
      // Create multiple transactions with the same token but different wallets
      const transactions = [
        {
          walletName: "QuickWallet1", 
          amount: 250000, 
          usdValue: 500
        },
        {
          walletName: "QuickWallet2", 
          amount: 350000, 
          usdValue: 700
        },
        {
          walletName: "QuickWallet3", 
          amount: 450000, 
          usdValue: 900
        }
      ];
      
      bot.sendMessage(
        chatId,
        `🧪 <b>Starting quick simulation with token ${coinName}</b>`,
        { parse_mode: 'HTML' }
      );
      
      // Add each transaction
      for (const tx of transactions) {
        const transaction = new Transaction(
          tx.walletName,
          'buy',
          coinName,
          coinAddress,
          tx.amount,
          tx.usdValue,
          new Date(),
          50000 // Fixed MarketCap for this test
        );
        
        await confluenceService.addTransaction(transaction, chatId.toString());
        
        bot.sendMessage(
          chatId,
          `🧪 Added transaction: ${tx.walletName} bought ${tx.amount.toLocaleString()} ${coinName}`,
          { parse_mode: 'HTML' }
        );
        
        // Small delay between transactions
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // Check for confluences
      const confluences = confluenceService.checkConfluences(chatId.toString());
      
      if (confluences && confluences.length > 0) {
        // Send a message to the group
        for (const confluence of confluences) {
          const formattedMessage = telegramService.formatConfluenceMessage(confluence);
          bot.sendMessage(chatId, formattedMessage, { parse_mode: 'HTML' });
        }
      } else {
        bot.sendMessage(
          chatId,
          `⚠️ No confluence detected after quick simulation!`,
          { parse_mode: 'HTML' }
        );
        
        // Dump transactions for debugging
        confluenceService.findTransactionsForToken(coinName);
      }
      
    } catch (error) {
      logger.error(`Error in quick simulation: ${error.message}`);
      bot.sendMessage(
        chatId,
        `❌ Error during quick simulation: ${error.message}`,
        { parse_mode: 'HTML' }
      );
    }
  });
  
  // Helper function to check if a user is admin (adapt as needed)
  function isAdmin(userId) {
    // You can implement a real check here
    // or simply return true to allow everyone to use simulation commands
    return true;
  }
}

module.exports = registerCommands;