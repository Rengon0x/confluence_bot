/**
 * Schema definition for a Confluence in MongoDB
 * 
 * With MongoDB native driver, we don't have formal schema validation like Mongoose,
 * but we define the expected structure here for documentation purposes.
 * 
 * This model stores detected confluences to improve performance by eliminating 
 * the need to recalculate them from scratch on every new transaction.
 */

/**
 * @typedef {Object} Confluence
 * @property {ObjectId} _id - MongoDB document ID
 * @property {string} groupId - Telegram group ID
 * @property {string} tokenAddress - Cryptocurrency token address (if available)
 * @property {string} tokenSymbol - Cryptocurrency token symbol/name
 * @property {string} type - Primary transaction type ('buy' or 'sell')
 * @property {Array} wallets - Array of wallet objects involved in the confluence
 * @property {number} count - Total unique wallets in the confluence
 * @property {number} nonMetadataCount - Count of wallets with actual transactions (non-metadata)
 * @property {number} totalAmount - Total token amount across all wallets
 * @property {number} totalUsdValue - Total USD value across all wallets
 * @property {number} totalBaseAmount - Total base currency amount (SOL/ETH)
 * @property {number} avgMarketCap - Average market cap from transactions
 * @property {Date} timestamp - When this confluence was first detected
 * @property {Date} lastUpdated - When this confluence was last updated
 * @property {boolean} isUpdate - Whether this is an update to a previous confluence
 * @property {number} buyCount - Number of wallets with buy transactions
 * @property {number} sellCount - Number of wallets with sell transactions
 * @property {boolean} is48hWindow - Whether this confluence spans a 48h window
 * @property {boolean} isActive - Whether this confluence is currently active
 */

/**
 * Example confluence document in MongoDB:
 * {
 *   _id: ObjectId("..."),
 *   groupId: "-12345678",
 *   tokenAddress: "AYSpV5CjExTKRKdqhWLEtwHRdbZQDNHpXEnVAP4gpump",
 *   tokenSymbol: "EFFECT",
 *   type: "buy",
 *   wallets: [
 *     {
 *       walletName: "Bastille",
 *       walletAddress: "7kYTBm8...",
 *       amount: 17849148.81,
 *       usdValue: 1200,
 *       baseAmount: 5.94,
 *       baseSymbol: "SOL",
 *       marketCap: 250000,
 *       type: "buy",
 *       isUpdated: false,
 *       isFromMetadata: false
 *     },
 *     // more wallets...
 *   ],
 *   count: 3,
 *   nonMetadataCount: 3,
 *   totalAmount: 53547446.43,
 *   totalUsdValue: 3600,
 *   totalBaseAmount: 17.82,
 *   avgMarketCap: 250000,
 *   timestamp: ISODate("2025-05-04T12:21:41Z"),
 *   lastUpdated: ISODate("2025-05-04T12:21:41Z"),
 *   isUpdate: false,
 *   buyCount: 3,
 *   sellCount: 0,
 *   is48hWindow: false,
 *   isActive: true
 * }
 */

module.exports = {
    // Collection name
    collectionName: 'confluences',
    
    // Indexes to create
    indexes: [
      // Primary indexes for fast lookups - non-unique to support different groups
      { key: { groupId: 1, tokenAddress: 1 }, sparse: true },
      { key: { groupId: 1, tokenSymbol: 1 }, sparse: true },
      
      // Compound unique index for either address or symbol within a group
      { key: { groupId: 1, tokenAddress: 1, isActive: 1 }, unique: false, sparse: true, background: true },
      { key: { groupId: 1, tokenSymbol: 1, isActive: 1 }, unique: false, sparse: true, background: true },
      
      // Performance indexes
      { key: { groupId: 1, timestamp: -1 }, background: true },
      { key: { timestamp: 1 }, background: true },
      { key: { lastUpdated: 1 }, background: true },
      { key: { isActive: 1 }, background: true },
      
      // Index for timestamp-based queries
      { key: { groupId: 1, lastUpdated: -1 }, background: true }
    ],
    
    // Default values for new confluences
    defaults: {
      isActive: true
    }
  };