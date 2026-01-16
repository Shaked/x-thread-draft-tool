/**
 * Utility functions for splitting long text into thread-sized chunks
 */

const MAX_CHARS = 280;

/**
 * Splits text into chunks that fit within the character limit
 * Attempts to break at word boundaries when possible
 * @param {string} text - Text to split
 * @param {number} maxChars - Maximum characters per chunk (default: 280)
 * @returns {string[]} - Array of text chunks
 */
export function splitIntoThreads(text, maxChars = MAX_CHARS) {
  if (!text || text.length === 0) return [];

  // If text fits in one tweet, return as single chunk
  if (text.length <= maxChars) {
    return [text];
  }

  const chunks = [];
  let remaining = text.trim();

  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      chunks.push(remaining);
      break;
    }

    // Try to find a good break point (space, newline, punctuation)
    let breakPoint = maxChars;
    const searchStart = Math.max(0, maxChars - 50); // Look back up to 50 chars

    // Look for word boundaries (spaces, newlines)
    const spaceIndex = remaining.lastIndexOf(' ', breakPoint);
    const newlineIndex = remaining.lastIndexOf('\n', breakPoint);
    const punctuationIndex = remaining.lastIndexOf('.', breakPoint);

    // Prefer newline, then space, then punctuation
    if (newlineIndex >= searchStart) {
      breakPoint = newlineIndex + 1;
    } else if (spaceIndex >= searchStart) {
      breakPoint = spaceIndex + 1;
    } else if (punctuationIndex >= searchStart) {
      breakPoint = punctuationIndex + 1;
    }

    // Extract chunk and update remaining
    const chunk = remaining.substring(0, breakPoint).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
    remaining = remaining.substring(breakPoint).trim();
  }

  return chunks;
}

/**
 * Validates if text fits within character limit
 * @param {string} text - Text to validate
 * @param {number} maxChars - Maximum characters allowed (default: 280)
 * @returns {boolean} - True if text fits within limit
 */
export function isValidLength(text, maxChars = MAX_CHARS) {
  return !text || text.length <= maxChars;
}

/**
 * Gets character count for text
 * @param {string} text - Text to count
 * @returns {number} - Character count
 */
export function getCharCount(text) {
  return text ? text.length : 0;
}
