// src/bot/commands/admin/index.js
const debugCommand = require('./debugCommand');
const simulateCommand = require('./simulateCommand');
const cacheCommand = require('./cacheCommand');
const quickSimCommand = require('./quickSimCommand');

// Exporter toutes les commandes admin
module.exports = [
  debugCommand,
  simulateCommand,
  cacheCommand,
  quickSimCommand
];