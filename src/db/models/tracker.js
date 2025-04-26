/**
 * Schema definition for a Tracker
 * 
 * With MongoDB native driver, we don't have formal schema validation like Mongoose,
 * but we define the expected structure here for documentation purposes.
 * 
 * A tracker represents a specific instance of a wallet tracking bot for a specific group.
 * Each group has its own tracker instances, even if they use the same tracker name.
 */

/**
 * @typedef {Object} Tracker
 * @property {ObjectId} _id - MongoDB document ID
 * @property {string} name - Name of the tracker (e.g., "CieloTrackerPrivate")
 * @property {string} groupId - ID of the Telegram group this tracker belongs to
 * @property {string} type - Type of tracker ('cielo', 'defined', 'ray')
 * @property {boolean} active - Whether this tracker is active
 * @property {Date} createdAt - When this tracker was created
 * @property {Date} updatedAt - When this tracker was last updated
 */

/**
 * Example tracker document in MongoDB:
 * {
 *   _id: ObjectId("..."),
 *   name: "CieloTrackerPrivate",
 *   groupId: "-12345678",
 *   type: "cielo",
 *   active: true,
 *   createdAt: ISODate("2025-04-10T12:00:00Z"),
 *   updatedAt: ISODate("2025-04-10T12:00:00Z")
 * }
 */

module.exports = {
  // Collection name
  collectionName: 'confluence_trackers',
  
  // Indexes to create
  indexes: [
    { key: { name: 1 } },
    { key: { groupId: 1 } },
    { key: { name: 1, groupId: 1 }, unique: true },
    { key: { active: 1 } },
    { key: { type: 1 } }
  ],
  
  // Default values for new trackers
  defaults: {
    active: true,
    type: 'cielo'
  }
};