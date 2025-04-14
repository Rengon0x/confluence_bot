/**
 * Class representing a crypto transaction
 */
class Transaction {
  /**
   * Create a new transaction
   * @param {string} walletName - Name or alias of the wallet
   * @param {string} type - Transaction type ('buy', 'sell')
   * @param {string} coin - Symbol or name of the cryptocurrency
   * @param {string} coinAddress - Blockchain address of the cryptocurrency (optional)
   * @param {number} amount - Transaction amount (in crypto units)
   * @param {number} usdValue - USD value of the transaction (optional)
   * @param {Date} timestamp - Transaction date and time
   * @param {number} marketCap - Market cap of the token (optional)
   */
  constructor(walletName, type, coin, coinAddress, amount, usdValue, timestamp, marketCap = 0) {
    this.walletName = walletName;
    this.type = type.toLowerCase(); // 'buy' or 'sell'
    this.coin = coin.toUpperCase();
    this.coinAddress = coinAddress || ''; // Nouveau champ pour l'adresse du token
    this.amount = amount;
    this.usdValue = usdValue;
    this.timestamp = timestamp || new Date();
    this.marketCap = marketCap;
  }

  /**
   * Check if the transaction is recent relative to a given time window
   * @param {number} windowMinutes - Time window in minutes
   * @returns {boolean} - True if the transaction is within the time window
   */
  isRecent(windowMinutes) {
    const now = new Date();
    const diffMs = now - this.timestamp;
    const diffMinutes = diffMs / 60000;
    return diffMinutes <= windowMinutes;
  }
}

module.exports = Transaction;