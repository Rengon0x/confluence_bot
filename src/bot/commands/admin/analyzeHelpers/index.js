const processorFunctions = require('./processorFunctions');
const formattingFunctions = require('./formattingFunctions');
const messagingFunctions = require('./messagingFunctions');

module.exports = {
  ...processorFunctions,
  ...formattingFunctions,
  ...messagingFunctions
};