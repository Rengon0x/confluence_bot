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
    minWallets: 2,
    windowMinutes: 120
  },
  mongodb: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/confluence-bot'
  },
  redis: {
    uri: process.env.REDIS_URI || 'redis://localhost:6379',
    enabled: process.env.USE_REDIS === 'true' || false,
    transactionsCachePrefix: 'conflubot:transactions:',
    confluencesCachePrefix: 'conflubot:confluences:'
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info'
  },
  supportContact: process.env.SUPPORT_CONTACT || 'your_username',

  // Access control settings
  accessControl: {
    enabled: true,
    maxUsers: parseInt(process.env.MAX_USERS || '100'),
    contactUser: process.env.CONTACT_USER || 'rengon0x'
  },
  
  // Admin users who can manage the bot and bypass access control
  adminUsers: (() => {
    // Hard-code your exact user ID directly - from logs, we see it's 1718036512
    console.log('Setting up admin user ID');
    return ['1718036512'];  // Rengon0x's actual user ID
  })()
};