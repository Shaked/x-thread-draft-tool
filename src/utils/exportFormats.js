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
 * Exports thread as plain text with a "i/N" line before each post (the UI's "Copy (Numbered)").
 * @param {Array} tweets - Array of tweet objects
 * @returns {string} - Numbered plain text
 */
export function exportAsNumberedText(tweets) {
  return tweets
    .map((tweet, index) => `${index + 1}/${tweets.length}\n${tweet.text}`)
    .join('\n\n');
}
