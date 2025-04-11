/**
 * Schema definition for a Group
 * 
 * With MongoDB native driver, we don't have formal schema validation like Mongoose,
 * but we define the expected structure here for documentation purposes.
 * 
 * A group represents a Telegram group where our bot and forwarder are active.
 */

/**
 * @typedef {Object} Group
 * @property {ObjectId} _id - MongoDB document ID
 * @property {string} groupId - Telegram group ID
 * @property {string} groupName - Name of the Telegram group
 * @property {Object} settings - Group settings
 * @property {number} settings.minWallets - Minimum wallets for confluence detection
 * @property {number} settings.windowMinutes - Time window for confluence detection
 * @property {boolean} active - Whether this group is active
 * @property {Date} createdAt - When this group was created
 * @property {Date} updatedAt - When this group was last updated
 */

/**
 * Example group document in MongoDB:
 * {
 *   _id: ObjectId("..."),
 *   groupId: "-12345678",
 *   groupName: "Crypto Trading Group",
 *   settings: {
 *     minWallets: 2,
 *     windowMinutes: 60
 *   },
 *   active: true,
 *   createdAt: ISODate("2025-04-10T12:00:00Z"),
 *   updatedAt: ISODate("2025-04-10T12:00:00Z")
 * }
 */

module.exports = {
    // Collection name
    collectionName: 'groups',
    
    // Indexes to create
    indexes: [
      { key: { groupId: 1 }, unique: true },
      { key: { active: 1 } }
    ],
    
    // Default values for new groups
    defaults: {
      settings: {
        minWallets: 2,
        windowMinutes: 60
      },
      active: true
    }
  };