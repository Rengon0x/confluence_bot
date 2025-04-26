// src/db/models/transaction.js
/**
 * Schema definition for a Transaction in MongoDB
 */
module.exports = {
    // Collection name
    collectionName: 'confluence_transactions',
    
    // Indexes to create - optimized for scaling and frequent queries
    indexes: [
      // Simple indexes
      { key: { groupId: 1 } },
      { key: { type: 1 } },
      { key: { coin: 1 } },
      { key: { coinAddress: 1 } },
      { key: { walletName: 1 } },
      
      // Timestamp index with TTL
      { key: { timestamp: 1 }, expireAfterSeconds: 172800 },  // TTL index - 48 hours
      
      // Composite indexes for frequent queries
      { key: { groupId: 1, timestamp: 1 }, name: 'group_time_lookup' }, // For loadRecentTransactions
      { key: { groupId: 1, type: 1, timestamp: 1 }, name: 'group_type_time_lookup' }, // For confluence detection
      
      // Specific heavily used indexes
      { key: { groupId: 1, type: 1, coin: 1 }, name: 'group_type_coin_lookup' },
      { key: { groupId: 1, type: 1, coinAddress: 1 }, name: 'group_type_coinaddress_lookup' },
      
      // Indexes for aggregation queries
      { key: { walletName: 1, groupId: 1 }, name: 'wallet_group_lookup' },
      { key: { groupId: 1, walletName: 1, timestamp: -1 }, name: 'recent_wallet_lookup' }
    ],
    
    // Default values for new transactions
    defaults: {}
};