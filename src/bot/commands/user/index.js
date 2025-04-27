// src/bot/commands/user/index.js
const startCommand = require('./startCommand');
const setupCommand = require('./setupCommand');
const stopCommand = require('./stopCommand');
const settingsCommand = require('./settingsCommand');
const statusCommand = require('./statusCommand');
const removeCommand = require('./removeCommand');
const recapCommand = require('./recapCommand');
const quickRecapCommand = require('./quickRecapCommand');
const addTrackerCommand = require('./addTrackerCommand');
const helpCommand = require('./helpCommand'); 
const TrackersCommand = require('./TrackersCommand');

// Exporter toutes les commandes utilisateur
module.exports = [
  startCommand,
  helpCommand,
  setupCommand,
  stopCommand,
  settingsCommand,
  statusCommand,
  removeCommand,
  recapCommand,
  quickRecapCommand,
  addTrackerCommand,
  TrackersCommand
];