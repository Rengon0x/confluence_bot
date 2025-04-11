/**
 * Class representing a tracked wallet
 */
class Wallet {
  /**
   * Create a new wallet
   * @param {string} address - Wallet address
   * @param {string} name - Wallet name or alias (optional)
   */
  constructor(address, name) {
    this.address = address;
    this.name = name || address.substring(0, 8) + '...';
    this.transactions = [];
  }

  /**
   * Add a transaction to the wallet
   * @param {Transaction} transaction - Transaction to add
   */
  addTransaction(transaction) {
    this.transactions.push(transaction);
    
    // Sort transactions in descending chronological order
    this.transactions.sort((a, b) => b.timestamp - a.timestamp);
    
    // Limit the number of stored transactions to avoid memory overload
    if (this.transactions.length > 100) {
      this.transactions = this.transactions.slice(0, 100);
    }
  }

  /**
   * Get the wallet's recent transactions
   * @param {number} windowMinutes - Time window in minutes
   * @returns {Array} - Recent transactions
   */
  getRecentTransactions(windowMinutes) {
    const now = new Date();
    return this.transactions.filter(tx => {
      const diffMs = now - tx.timestamp;
      const diffMinutes = diffMs / 60000;
      return diffMinutes <= windowMinutes;
    });
  }
}

module.exports = Wallet;