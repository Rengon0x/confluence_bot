// src/bot/commands/user/index.js
const startCommand = require('./startCommand');
const setupCommand = require('./setupCommand');
const stopCommand = require('./stopCommand');
const settingsCommand = require('./settingsCommand');
const statusCommand = require('./statusCommand');
const removeCommand = require('./removeCommand');
const recapCommand = require('./recapCommand'); 

// Exporter toutes les commandes utilisateur
module.exports = [
  startCommand,
  setupCommand,
  stopCommand,
  settingsCommand,
  statusCommand,
  removeCommand,
  recapCommand  
];