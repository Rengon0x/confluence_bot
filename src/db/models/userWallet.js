// src/db/models/userWallet.js
module.exports = {
    // Collection name
    collectionName: 'confluence_user_wallets',
    
    // Indexes to create
    indexes: [
      { key: { userId: 1 } },
      { key: { username: 1 } },
      { key: { walletAddress: 1 } },
      { key: { trackerSource: 1 } },
      { key: { 'wallets.address': 1 } },
      { key: { userId: 1, walletAddress: 1 }, unique: true }
    ],
    
    // Default values
    defaults: {}
  };