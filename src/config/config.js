require('dotenv').config();

module.exports = {
  telegram: {
    botToken: process.env.BOT_TOKEN,
    botUsername: process.env.BOT_USERNAME || 'your_bot_username',
    forwarders: [
      {
        id: 'forwarder1',
        forwarderUsername: process.env.FORWARDER_USERNAME,
        phoneNumber: process.env.FORWARDER1_PHONE_NUMBER,
        apiId: parseInt(process.env.TELEGRAM_API_ID || '0'),
        apiHash: process.env.TELEGRAM_API_HASH || '',
        sessionPath: 'telegram-session-1.txt'
      },
      {
        id: 'forwarder2',
        forwarderUsername: process.env.FORWARDER_USERNAME_2,
        phoneNumber: process.env.FORWARDER2_PHONE_NUMBER_2,
        apiId: parseInt(process.env.TELEGRAM_API_ID_2 || '0'),
        apiHash: process.env.TELEGRAM_API_HASH_2 || '',
        sessionPath: 'telegram-session-2.txt'
      }
    ]
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