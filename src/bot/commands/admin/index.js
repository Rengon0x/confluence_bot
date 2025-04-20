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
  stablecoinTxCommands.sellTxUsdcCommand
];