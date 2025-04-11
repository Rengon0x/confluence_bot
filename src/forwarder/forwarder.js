require('dotenv').config();
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const input = require('input');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const logger = require('./utils/logger');
const config = require('./config/config');
const db = require('./db');

// Path to save the session
const DATA_DIR = path.join(__dirname, '../data');
const SESSION_FILE_PATH = path.join(DATA_DIR, 'telegram-session.txt');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Check if session exists
let sessionData = '';
if (fs.existsSync(SESSION_FILE_PATH)) {
  sessionData = fs.readFileSync(SESSION_FILE_PATH, 'utf8');
}

const stringSession = new StringSession(sessionData);

// Initialize the Telegram client
const client = new TelegramClient(
  stringSession,
  config.telegram.apiId,
  config.telegram.apiHash,
  { connectionRetries: 5 }
);

// Keep track of which trackers we're monitoring
const monitoredTrackers = new Map();

// Forward message to our bot through the Bot API
async function forwardMessage(trackerName, message) {
  try {
    // Get all groups that need this message
    const groups = await db.getGroupsForTracker(trackerName);
    
    if (groups.length === 0) {
      logger.debug(`No groups registered for tracker: ${trackerName}`);
      return;
    }
    
    logger.info(`Forwarding message from ${trackerName} to ${groups.length} groups`);
    
    // Forward to each group
    for (const group of groups) {
      try {
        // Send the message to our bot's API
        await axios.post(`https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`, {
          chat_id: group.id,
          text: message,
          parse_mode: 'HTML'
        });
        
        logger.debug(`Message forwarded to group: ${group.name} (${group.id})`);
      } catch (error) {
        logger.error(`Error forwarding to group ${group.id}: ${error.message}`);
      }
    }
  } catch (error) {
    logger.error(`Error in forwardMessage: ${error.message}`);
  }
}

// Start monitoring a tracker
async function startMonitoringTracker(trackerName) {
  try {
    // Check if we're already monitoring this tracker
    if (monitoredTrackers.has(trackerName)) {
      logger.info(`Already monitoring tracker: ${trackerName}`);
      return true;
    }
    
    logger.info(`Starting to monitor tracker: ${trackerName}`);
    
    // Get the entity for this tracker
    const entity = await client.getEntity(trackerName);
    
    if (!entity) {
      logger.error(`Could not find entity for tracker: ${trackerName}`);
      return false;
    }
    
    // Create event handler for this tracker
    const handler = client.addEventHandler(async (event) => {
      const message = event.message;
      
      // Don't process messages from the bot itself or empty messages
      if (message.out || !message.text) return;
      
      logger.debug(`Received message from ${trackerName}: ${message.text.substring(0, 50)}...`);
      
      // Forward the message to the bot for processing
      await forwardMessage(trackerName, message.text);
      
    }, new NewMessage({ chats: [entity] }));
    
    // Store the handler so we can remove it later if needed
    monitoredTrackers.set(trackerName, {
      entity,
      handler,
      startTime: new Date()
    });
    
    logger.info(`Successfully monitoring tracker: ${trackerName}`);
    return true;
  } catch (error) {
    logger.error(`Error starting to monitor tracker ${trackerName}: ${error.message}`);
    return false;
  }
}

// Stop monitoring a tracker
async function stopMonitoringTracker(trackerName) {
  try {
    const tracker = monitoredTrackers.get(trackerName);
    
    if (!tracker) {
      logger.warn(`Not currently monitoring tracker: ${trackerName}`);
      return false;
    }
    
    // Remove the event handler
    client.removeEventHandler(tracker.handler);
    monitoredTrackers.delete(trackerName);
    
    logger.info(`Stopped monitoring tracker: ${trackerName}`);
    return true;
  } catch (error) {
    logger.error(`Error stopping monitoring for ${trackerName}: ${error.message}`);
    return false;
  }
}

// Update monitored trackers based on database
async function updateMonitoredTrackers() {
  try {
    // Get all active trackers from the database
    const activeTrackers = await db.getAllActiveTrackers();
    
    // Start monitoring new trackers
    for (const tracker of activeTrackers) {
      if (!monitoredTrackers.has(tracker.name)) {
        await startMonitoringTracker(tracker.name);
      }
    }
    
    // Log status
    logger.info(`Currently monitoring ${monitoredTrackers.size} trackers`);
  } catch (error) {
    logger.error(`Error updating monitored trackers: ${error.message}`);
  }
}

// Initialize and start the forwarder
async function startForwarder() {
  logger.info('Starting Multi-Tracker Forwarder...');
  
  // Login to Telegram
  await client.start({
    phoneNumber: async () => config.telegram.forwarderPhoneNumber || await input.text('Please enter your phone number: '),
    password: async () => await input.text('Please enter your password: '),
    phoneCode: async () => await input.text('Please enter the code you received: '),
    onError: (err) => logger.error('Login error:', err),
  });
  
  // Save the session for future use
  const sessionString = client.session.save();
  fs.writeFileSync(SESSION_FILE_PATH, sessionString);
  logger.info(`Session saved to ${SESSION_FILE_PATH}`);
  
  logger.info('Connected to Telegram!');
  
  // Start monitoring all active trackers
  await updateMonitoredTrackers();
  
  // Periodically check for new trackers to monitor
  setInterval(updateMonitoredTrackers, 60000); // Check every minute
  
  logger.info('Forwarder is now running.');
}

// Stop the forwarder gracefully
async function stopForwarder() {
  logger.info('Stopping forwarder...');
  
  // Stop monitoring all trackers
  for (const [trackerName] of monitoredTrackers) {
    await stopMonitoringTracker(trackerName);
  }
  
  // Disconnect from Telegram
  await client.disconnect();
  
  logger.info('Forwarder stopped.');
}

// Handle application shutdown
process.on('SIGINT', async () => {
  logger.info('Received SIGINT signal');
  await stopForwarder();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM signal');
  await stopForwarder();
  process.exit(0);
});

// Start the forwarder if this file is run directly
if (require.main === module) {
  startForwarder().catch(error => {
    logger.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = {
  startMonitoringTracker,
  stopMonitoringTracker,
  updateMonitoredTrackers
};