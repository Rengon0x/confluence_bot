// cleanTransactions.js
require('dotenv').config();
const { MongoClient } = require('mongodb');
const logger = require('./logger');

/**
 * Script pour nettoyer les transactions sans adresse de token
 */
async function cleanTransactionsWithoutAddress() {
  let client;
  try {
    // Récupérer l'URI MongoDB depuis les variables d'environnement
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      console.error('MONGODB_URI non définie dans le fichier .env');
      process.exit(1);
    }

    // Se connecter à MongoDB
    client = new MongoClient(uri);
    await client.connect();
    console.log('Connecté à MongoDB');

    // Accéder à la base de données et la collection des transactions
    const database = client.db('telegram_bot'); // Nom de votre base de données
    const collection = database.collection('confluence_transactions'); // Nom de la collection des transactions

    // Compter le nombre total de transactions
    const totalTransactions = await collection.countDocuments();
    console.log(`Nombre total de transactions: ${totalTransactions}`);

    // Compter les transactions sans adresse de token
    const transactionsWithoutAddress = await collection.countDocuments({ 
      $or: [
        { coinAddress: { $exists: false } },
        { coinAddress: "" },
        { coinAddress: null }
      ]
    });
    console.log(`Transactions sans adresse de token: ${transactionsWithoutAddress}`);

    // Demander confirmation avant de supprimer
    if (process.argv.includes('--confirm')) {
      // Supprimer les transactions sans adresse de token
      const result = await collection.deleteMany({ 
        $or: [
          { coinAddress: { $exists: false } },
          { coinAddress: "" },
          { coinAddress: null }
        ]
      });
      
      console.log(`${result.deletedCount} transactions ont été supprimées`);
    } else {
      console.log('Pour exécuter la suppression, lancez le script avec le paramètre --confirm');
      console.log('Exemple: node src/utils/cleanTransactions.js --confirm ');
    }

    // Bonus: Afficher des statistiques sur les transactions restantes
    if (process.argv.includes('--stats')) {
      // Transactions par type (buy/sell)
      const typeStats = await collection.aggregate([
        { $group: { _id: "$type", count: { $sum: 1 } } }
      ]).toArray();
      
      console.log('\nStatistiques par type:');
      typeStats.forEach(stat => {
        console.log(`- ${stat._id}: ${stat.count} transactions`);
      });

      // Top 10 des tokens les plus fréquents
      const topTokens = await collection.aggregate([
        { $match: { coinAddress: { $exists: true, $ne: "" } } },
        { $group: { _id: "$coinAddress", count: { $sum: 1 }, name: { $first: "$coin" } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ]).toArray();
      
      console.log('\nTop 10 des tokens par nombre de transactions:');
      topTokens.forEach((token, index) => {
        console.log(`${index+1}. ${token.name} (${token._id}): ${token.count} transactions`);
      });
    }
  } catch (error) {
    console.error('Erreur lors du nettoyage des transactions:', error);
  } finally {
    // Fermer la connexion MongoDB
    if (client) {
      await client.close();
      console.log('Connexion MongoDB fermée');
    }
  }
}

// Exécuter le script
cleanTransactionsWithoutAddress().catch(console.error);