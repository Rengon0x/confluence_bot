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
      { key: { coinAddress: 1 } },  // Nouvel index sur l'adresse du token
      { key: { timestamp: 1 } },
      { key: { walletName: 1 } },  // Modifié depuis walletAddress
      { key: { groupId: 1, type: 1, coin: 1 }, name: 'group_type_coin_lookup' },
      { key: { groupId: 1, type: 1, coinAddress: 1 }, name: 'group_type_coinaddress_lookup' },  // Nouvel index composite
      { key: { timestamp: 1 }, expireAfterSeconds: 172800 }  // TTL index - 48 heures
    ],
    
    // Default values for new transactions
    defaults: {}
};