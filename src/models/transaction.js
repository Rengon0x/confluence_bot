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
   * @param {number} baseAmount - Amount of base token (SOL/ETH) used (optional)
   * @param {string} baseSymbol - Symbol of base token (SOL/ETH) (optional)
   * @param {string} walletAddress - Address of the wallet (optional)
   */
  constructor(
    walletName,
    type,
    coin,
    coinAddress,
    amount,
    usdValue,
    timestamp,
    marketCap = 0,
    baseAmount = 0,
    baseSymbol = '',
    walletAddress = '' 
  ) {
    this.walletName = walletName;
    this.type = type.toLowerCase();
    this.coin = coin.toUpperCase();
    
    // Ensure coinAddress is stored properly - normalize and validate it
    this.coinAddress = this.normalizeAddress(coinAddress);
    
    this.amount = amount;
    this.usdValue = usdValue;
    this.timestamp = timestamp || new Date();
    this.marketCap = marketCap;
    this.baseAmount = baseAmount;
    this.baseSymbol = baseSymbol;
    
    // Store wallet address properly as well
    this.walletAddress = this.normalizeAddress(walletAddress);
  }

  /**
   * Normalize and validate an address
   * @param {string} address - Token or wallet address
   * @returns {string} - Normalized address or empty string
   */
  normalizeAddress(address) {
    // Check if address is valid
    if (!address || typeof address !== 'string') {
      return '';
    }
    
    // Trim whitespace and check length
    const trimmed = address.trim();
    
    // Not storing addresses that are too short or invalid placeholders
    if (trimmed.length < 30 || 
        trimmed === 'unknown' || 
        trimmed === 'undefined' ||
        trimmed === 'none') {
      return '';
    }
    
    return trimmed;
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
  
  /**
   * Check if the transaction has a valid coin address
   * @returns {boolean} - True if the transaction has a valid coin address
   */
  hasValidCoinAddress() {
    return this.coinAddress && this.coinAddress.length >= 30;
  }
}

module.exports = Transaction;