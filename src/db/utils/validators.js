/**
 * Database validation utilities
 */
const validators = {
  /**
   * Validate tracker name format
   * @param {string} name - Tracker name to validate
   * @returns {boolean} Whether the name is valid
   */
  isValidTrackerName(name) {
    if (!name || typeof name !== 'string') return false;
    
    // Remove @ if present
    name = name.replace(/^@/, '');
    
    // Tracker name should be alphanumeric with underscores
    // and between 5-32 characters (Telegram username rules)
    return /^[a-zA-Z0-9_]{5,32}$/.test(name);
  },
  
  /**
   * Validate group ID format
   * @param {string|number} groupId - Group ID to validate
   * @returns {boolean} Whether the ID is valid
   */
  isValidGroupId(groupId) {
    if (!groupId) return false;
    
    // Convert to string if it's a number
    if (typeof groupId === 'number') {
      groupId = groupId.toString();
    }
    
    // Group IDs are usually negative numbers
    return /^-?\d+$/.test(groupId);
  },
  
  /**
   * Validate settings object
   * @param {Object} settings - Settings object to validate
   * @returns {Object} Validated settings (only valid properties kept)
   */
  validateSettings(settings) {
    const validatedSettings = {};
    
    // Validate min wallets (must be between 2 and 10)
    if (settings.minWallets !== undefined) {
      const minWallets = parseInt(settings.minWallets);
      if (!isNaN(minWallets) && minWallets >= 2 && minWallets <= 10) {
        validatedSettings.minWallets = minWallets;
      }
    }
    
    // Validate window minutes (must be between 60 and 2880)
    // 60 minutes = 1 hour
    // 2880 minutes = 48 hours
    if (settings.windowMinutes !== undefined) {
      const windowMinutes = parseInt(settings.windowMinutes);
      if (!isNaN(windowMinutes) && windowMinutes >= 60 && windowMinutes <= 2880) {
        validatedSettings.windowMinutes = windowMinutes;
      }
    }
    
    return validatedSettings;
  }
};

module.exports = validators;