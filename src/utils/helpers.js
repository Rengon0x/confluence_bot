/**
 * Various utility functions
 */
const helpers = {
  /**
   * Shorten a wallet address for display
   * @param {string} address - Complete address
   * @param {number} startChars - Number of characters to keep at the beginning
   * @param {number} endChars - Number of characters to keep at the end
   * @returns {string} - Shortened address
   */
  shortenAddress(address, startChars = 6, endChars = 4) {
    if (!address || address.length <= startChars + endChars) {
      return address;
    }
    return `${address.substring(0, startChars)}...${address.substring(address.length - endChars)}`;
  },

  /**
   * Format a number with thousands separators and decimals
   * @param {number} number - Number to format
   * @param {number} decimals - Number of decimals to display
   * @returns {string} - Formatted number
   */
  formatNumber(number, decimals = 2) {
    return number.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  },

  /**
   * Format a date
   * @param {Date} date - Date to format
   * @returns {string} - Formatted date
   */
  formatDate(date) {
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }
};

module.exports = helpers;