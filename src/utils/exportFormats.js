/**
 * Export format generators for thread drafts
 */

/**
 * Exports thread as JSON format (for re-import)
 * @param {Object} draft - Draft object with title, createdAt, tweets
 * @returns {string} - JSON string
 */
export function exportAsJSON(draft) {
  return JSON.stringify(draft, null, 2);
}

/**
 * Exports thread as plain text (one tweet per line)
 * @param {Array} tweets - Array of tweet objects
 * @returns {string} - Plain text format
 */
export function exportAsPlainText(tweets) {
  return tweets.map(tweet => tweet.text).join('\n\n');
}

/**
 * Exports thread as formatted text with separators
 * @param {Array} tweets - Array of tweet objects
 * @returns {string} - Formatted text
 */
export function exportAsFormattedText(tweets) {
  return tweets
    .map((tweet, index) => {
      return `Tweet ${index + 1}/${tweets.length} (${tweet.text.length} chars):\n${tweet.text}`;
    })
    .join('\n\n---\n\n');
}

/**
 * Formats thread for clipboard copy
 * @param {Array} tweets - Array of tweet objects
 * @param {boolean} includeNumbers - Whether to include tweet numbers
 * @returns {string} - Formatted text for clipboard
 */
export function formatForClipboard(tweets, includeNumbers = false) {
  if (includeNumbers) {
    return tweets
      .map((tweet, index) => `${index + 1}. ${tweet.text}`)
      .join('\n\n');
  }
  return exportAsPlainText(tweets);
}
