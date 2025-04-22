require('dotenv').config();

module.exports = {
  telegram: {
    botToken: process.env.BOT_TOKEN,
    botUsername: process.env.BOT_USERNAME || 'your_bot_username',
    apiId: parseInt(process.env.TELEGRAM_API_ID || '0'),
    apiHash: process.env.TELEGRAM_API_HASH || '',
    forwarderPhoneNumber: process.env.FORWARDER_PHONE_NUMBER || ''
  },
  confluence: {
    minWallets: parseInt(process.env.MIN_WALLETS_FOR_CONFLUENCE || '2', 10),
    windowMinutes: parseInt(process.env.CONFLUENCE_WINDOW_MINUTES || '1440', 10)
  },
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/confluence-bot'
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info'
  },
  supportContact: process.env.SUPPORT_CONTACT || 'your_username'
};