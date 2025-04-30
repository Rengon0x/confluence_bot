/**
 * Schema definition for a Beta User
 * 
 * With MongoDB native driver, we don't have formal schema validation like Mongoose,
 * but we define the expected structure here for documentation purposes.
 * 
 * BetaUsers represent authorized users who can interact with the bot during the beta phase.
 */

/**
 * @typedef {Object} BetaUser
 * @property {ObjectId} _id - MongoDB document ID
 * @property {string} username - Telegram username (without @)
 * @property {string} userId - Telegram user ID (if known)
 * @property {string} firstName - User's first name (if known)
 * @property {string} lastName - User's last name (if known)
 * @property {string} addedBy - Username or ID of admin who added this user
 * @property {Date} addedAt - When this user was added to the beta list
 * @property {Date} lastSeen - When this user was last seen interacting with the bot
 * @property {boolean} active - Whether this user is currently active/authorized
 */

/**
 * Example betaUser document in MongoDB:
 * {
 *   _id: ObjectId("..."),
 *   username: "johndoe",
 *   userId: "12345678",
 *   firstName: "John",
 *   lastName: "Doe",
 *   addedBy: "admin",
 *   addedAt: ISODate("2025-04-10T12:00:00Z"),
 *   lastSeen: ISODate("2025-04-15T18:30:00Z"),
 *   active: true
 * }
 */

module.exports = {
    // Collection name
    collectionName: 'beta_users',
    
    // Indexes to create
    indexes: [
      { key: { username: 1 }, unique: true },
      { key: { userId: 1 }, unique: true, sparse: true },
      { key: { active: 1 } },
      { key: { addedAt: 1 } },
      { key: { lastSeen: 1 } }
    ],
    
    // Default values for new betaUsers
    defaults: {
      active: true
    }
  };