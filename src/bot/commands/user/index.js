// src/bot/commands/user/index.js
const startCommand = require('./startCommand');
const setupCommand = require('./setupCommand');
const stopCommand = require('./stopCommand');
const settingsCommand = require('./settingsCommand');
const statusCommand = require('./statusCommand');
const recapCommand = require('./recapCommand');
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
  recapCommand,
  addTrackerCommand,
  TrackersCommand
];