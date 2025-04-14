const { MongoClient } = require('mongodb');
const logger = require('../utils/logger');
const config = require('../config/config');

// Import models to get their indexes
const TrackerModel = require('./models/tracker');
const GroupModel = require('./models/group');
const TransactionModel = require('./models/transaction');

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
        
        logger.info("MongoDB indexes created successfully");
    } catch (error) {
        logger.error("Error creating MongoDB indexes:", error);
    }
}


// Helper function to create or update an index
async function createOrUpdateIndex(collection, indexSpec) {
    try {
        // Try to create the index normally
        await collection.createIndex(indexSpec.key, { 
            unique: indexSpec.unique || false,
            background: true,
            ...(indexSpec.expireAfterSeconds && { expireAfterSeconds: indexSpec.expireAfterSeconds })
        });
    } catch (error) {
        // If the error indicates an existing index with the same name but different options
        if (error.message && error.message.includes("existing index")) {
            try {
                // Get the index name
                const indexName = Object.keys(indexSpec.key).map(k => `${k}_1`).join('_');
                
                // Drop the existing index
                logger.info(`Dropping existing index ${indexName} to recreate with new options`);
                await collection.dropIndex(indexName);
                
                // Retry creating the index
                await collection.createIndex(indexSpec.key, { 
                    unique: indexSpec.unique || false,
                    background: true,
                    ...(indexSpec.expireAfterSeconds && { expireAfterSeconds: indexSpec.expireAfterSeconds })
                });
                
                logger.info(`Successfully recreated index ${indexName} with new options`);
            } catch (dropError) {
                logger.error(`Error dropping and recreating index: ${dropError.message}`);
                throw dropError;
            }
        } else {
            throw error;
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

module.exports = {
    connectToDatabase,
    getDatabase
};