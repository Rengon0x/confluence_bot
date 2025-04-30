// src/bot/commands/admin/index.js
const debugCommand = require('./debugCommand');
const simulateCommand = require('./simulateCommand');
const cacheCommand = require('./cacheCommand');
const quickSimCommand = require('./quickSimCommand');
const sellTxCommand = require('./sellTxCommand');
const buyTxCommand = require('./buyTxCommand');
const simulateUsdcCommand = require('./simulateUsdcCommand');
const stablecoinTxCommands = require('./stablecoinTxCommands');
const analyzeAllCommand = require('./analyzeAllCommand');
const addUserCommand = require('./addUserCommand');
const removeUserCommand = require('./removeUserCommand');
const listUsersCommand = require('./listUsersCommand');

// Export all admin commands
module.exports = [
  debugCommand,
  simulateCommand,
  cacheCommand,
  quickSimCommand,
  sellTxCommand,
  buyTxCommand,
  simulateUsdcCommand,
  analyzeAllCommand,
  stablecoinTxCommands.buyTxUsdcCommand,
  stablecoinTxCommands.buyTxUsdtCommand,
  stablecoinTxCommands.sellTxUsdcCommand,
  
  // Add the new user management commands
  addUserCommand,
  removeUserCommand,
  listUsersCommand
];