// src/bot/commands/admin/index.js
const debugCommand = require('./debugCommand');
const simulateCommand = require('./simulateCommand');
const cacheCommand = require('./cacheCommand');
const quickSimCommand = require('./quickSimCommand');
const sellTxCommand = require('./sellTxCommand');
const buyTxCommand = require('./buyTxCommand');

// Export all admin commands
module.exports = [
  debugCommand,
  simulateCommand,
  cacheCommand,
  quickSimCommand,
  sellTxCommand,
  buyTxCommand
];