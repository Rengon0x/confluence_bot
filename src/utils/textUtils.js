/**
 * Utility functions for text processing
 */

/**
 * Finds a safe cutting point to split a long message
 * @param {string} text - Text to cut
 * @param {number} maxLength - Maximum length
 * @param {number} threshold - Threshold for minimum acceptable cut position
 * @returns {number} - Safe cutting position
 */
function findSafeCutPoint(text, maxLength, threshold = 0.5) {
    // First try to find a paragraph break (double newline)
    let cutPoint = text.lastIndexOf('\n\n', maxLength);
    
    // If no paragraph break or it's too close to the beginning, try a single line break
    if (cutPoint < maxLength * threshold) {
      cutPoint = text.lastIndexOf('\n', maxLength);
    }
    
    // If no line break or it's too close to the beginning, try a sentence end
    if (cutPoint < maxLength * threshold) {
      // Look for period followed by space or newline
      for (let i = Math.min(text.length - 1, maxLength); i >= 0; i--) {
        if ((text[i] === '.' || text[i] === '!' || text[i] === '?') && 
            (i + 1 >= text.length || text[i + 1] === ' ' || text[i + 1] === '\n') &&
            i > maxLength * threshold) {
          cutPoint = i + 1;
          break;
        }
      }
    }
    
    // If no sentence end, try a space
    if (cutPoint < maxLength * threshold) {
      cutPoint = text.lastIndexOf(' ', maxLength);
    }
    
    // If still no good cutting point, use maxLength but check for Markdown boundaries
    if (cutPoint < maxLength * threshold) {
      // Try to avoid cutting in the middle of markdown entities
      const markdownEntities = ['*', '_', '`', '[', ']'];
      for (let i = maxLength; i > maxLength * 0.9; i--) {
        if (markdownEntities.includes(text[i])) {
          continue; // Skip positions with markdown characters
        }
        cutPoint = i;
        break;
      }
      
      // If we couldn't find a good point even with the above checks, just use maxLength
      if (cutPoint < maxLength * threshold) {
        cutPoint = maxLength;
      }
    }
    
    return cutPoint;
  }
  
  /**
   * Removes Markdown formatting from text
   * @param {string} text - Text with Markdown formatting
   * @returns {string} - Text without formatting
   */
  function stripMarkdown(text) {
    // Replace headings and bold
    let stripped = text.replace(/\*\*/g, '');
    stripped = stripped.replace(/\*/g, '');
    
    // Replace italic
    stripped = stripped.replace(/_([^_]+)_/g, '$1');
    
    // Replace code blocks
    stripped = stripped.replace(/`([^`]+)`/g, '$1');
    
    return stripped;
  }
  
  module.exports = {
    findSafeCutPoint,
    stripMarkdown
  };