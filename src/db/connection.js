const { MongoClient } = require('mongodb');
const logger = require('../utils/logger');
const config = require('../config/config');

// Import models to get their indexes
const TrackerModel = require('./models/tracker');
const GroupModel = require('./models/group');
const TransactionModel = require('./models/transaction');
const ConfluenceModel = require('./models/confluence');
const BetaUserModel = require('./models/betaUser');
const UserWalletModel = require('./models/userWallet');

let mongoClient = null;
let db = null;

const uri = config.mongodb.uri?.trim() || process.env.MONGODB_URI?.trim();
if (!uri) throw new Error('MONGODB_URI is not defined');
if (!uri.startsWith('mongodb://') && !uri.startsWith('mongodb+srv://')) {
    throw new Error(`Invalid MongoDB URI: ${uri}`);
}

/**
 * Initialize the MongoDB client
 * @returns {MongoClient} MongoDB client
 */
function initializeClient() {
    if (!mongoClient) {
        mongoClient = new MongoClient(uri, {
            connectTimeoutMS: 5000,
            socketTimeoutMS: 30000,
        });
        mongoClient.setMaxListeners(20);
        
        mongoClient.on('close', async () => {
            logger.warn("Connection lost. Attempting to reconnect...");
            db = null;
            try {
                await connectToDatabase();
            } catch (error) {
                logger.error("Reconnection failed:", error);
            }
        });
    }
    return mongoClient;
}

/**
 * Connect to the MongoDB database
 * @returns {Db} MongoDB database instance
 */
async function connectToDatabase() {
    if (!db) {
        const client = initializeClient();
        await client.connect();
        db = client.db("telegram_bot");
        logger.info("Connected to MongoDB database: telegram_bot");
        
        // Set up indexes based on model definitions
        await setupIndexes(db);
    }
    return db;
}

/**
 * Get the database instance, connecting if necessary
 * @returns {Db} MongoDB database instance
 */
async function getDatabase() {
    return db || await connectToDatabase();
}

/**
 * Set up MongoDB indexes based on model definitions
 * @param {Db} database - The MongoDB database instance
 */
async function setupIndexes(database) {
    try {
        // Create indexes for trackers collection
        if (TrackerModel.indexes) {
            const trackerCollection = database.collection(TrackerModel.collectionName || 'trackers');
            for (const index of TrackerModel.indexes) {
                await createOrUpdateIndex(trackerCollection, index);
            }
        }
        
        // Create indexes for groups collection
        if (GroupModel.indexes) {
            const groupCollection = database.collection(GroupModel.collectionName || 'groups');
            for (const index of GroupModel.indexes) {
                await createOrUpdateIndex(groupCollection, index);
            }
        }

        // Create indexes for transactions collection
        if (TransactionModel.indexes) {
            const transactionCollection = database.collection(TransactionModel.collectionName);
            for (const index of TransactionModel.indexes) {
                await createOrUpdateIndex(transactionCollection, index);
            }
        }
        
        // Create indexes for confluences collection
        if (ConfluenceModel.indexes) {
            const confluenceCollection = database.collection(ConfluenceModel.collectionName);
            for (const index of ConfluenceModel.indexes) {
                await createOrUpdateIndex(confluenceCollection, index);
            }
        }
        
        // Create indexes for beta users collection
        if (BetaUserModel.indexes) {
            const betaUserCollection = database.collection(BetaUserModel.collectionName || 'betausers');
            for (const index of BetaUserModel.indexes) {
                try {
                    await createOrUpdateIndex(betaUserCollection, index);
                } catch (err) {
                    logger.warn(`Error creating index for beta users: ${err.message}`);
                }
            }
        }
        
        // Create indexes for user wallets collection
        if (UserWalletModel.indexes) {
            const userWalletCollection = database.collection(UserWalletModel.collectionName || 'userwallets');
            for (const index of UserWalletModel.indexes) {
                await createOrUpdateIndex(userWalletCollection, index);
            }
        }
        
        logger.info("MongoDB indexes created successfully");
    } catch (error) {
        logger.error("Error creating MongoDB indexes:", error);
    }
}


// Helper function to create or update an index
async function createOrUpdateIndex(collection, indexSpec) {
    try {
        // Add sparse option to unique indexes to allow multiple documents with missing fields
        const options = { 
            unique: indexSpec.unique || false,
            background: indexSpec.background || true,
            sparse: indexSpec.sparse === undefined ? indexSpec.unique : indexSpec.sparse, // default sparse=true for unique indexes
            ...(indexSpec.expireAfterSeconds && { expireAfterSeconds: indexSpec.expireAfterSeconds })
        };
        
        // Try to create the index normally
        await collection.createIndex(indexSpec.key, options);
    } catch (error) {
        // If the error indicates an existing index with the same name but different options
        if (error.message && error.message.includes("existing index")) {
            try {
                // Get the index name based on key fields
                let indexName = '';
                Object.entries(indexSpec.key).forEach(([field, direction]) => {
                    indexName += `${field}_${direction}`;
                });
                
                // Try dropping the existing index if we can identify it
                if (indexName) {
                    logger.debug(`Attempting to drop existing index ${indexName} to recreate`);
                    try {
                        await collection.dropIndex(indexName);
                        logger.debug(`Successfully dropped index ${indexName}`);
                    } catch (dropError) {
                        logger.debug(`Could not drop index by name: ${dropError.message}`);
                        // Continue without dropping - the error will be caught below
                    }
                }
                
                // Retry creating the index
                await collection.createIndex(indexSpec.key, { 
                    unique: indexSpec.unique || false,
                    background: indexSpec.background || true,
                    sparse: indexSpec.sparse === undefined ? indexSpec.unique : indexSpec.sparse,
                    ...(indexSpec.expireAfterSeconds && { expireAfterSeconds: indexSpec.expireAfterSeconds })
                });
                
                logger.debug(`Successfully recreated index for fields: ${Object.keys(indexSpec.key).join(', ')}`);
            } catch (retryError) {
                // Just log the error but don't throw - this allows other indexes to be created
                logger.warn(`Error recreating index: ${retryError.message}`);
            }
        } else {
            // Just log the error but don't throw - this allows other indexes to be created
            logger.warn(`Error creating index: ${error.message}`);
        }
    }
}

// Handle application shutdown
process.on('SIGINT', async () => {
    if (mongoClient) {
        logger.info("Closing MongoDB connection...");
        await mongoClient.close();
    }
    process.exit(0);
});

/**
 * Close the MongoDB connection
 */
async function closeConnection() {
    if (mongoClient) {
      await mongoClient.close();
      mongoClient = null;
      db = null;
      logger.info('MongoDB connection closed');
    }
  }
  
  // Add to module.exports
  module.exports = {
    connectToDatabase,
    getDatabase,
    closeConnection
  };