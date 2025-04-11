// src/db/models/transaction.js
/**
 * Schema definition for a Transaction in MongoDB
 */
module.exports = {
    // Collection name
    collectionName: 'confluence_transactions',
    
    // Indexes to create
    indexes: [
      { key: { groupId: 1 } },
      { key: { type: 1 } },
      { key: { coin: 1 } },
      { key: { timestamp: 1 } },
      { key: { walletAddress: 1 } },
      { key: { groupId: 1, type: 1, coin: 1 }, name: 'group_type_coin_lookup' },
      { key: { timestamp: 1 }, expireAfterSeconds: 172800 }  // TTL index - 48 hours
    ],
    
    // Default values for new transactions
    defaults: {}
  };