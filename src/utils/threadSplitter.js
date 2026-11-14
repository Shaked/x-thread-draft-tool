/**
 * Utility functions for splitting long text into thread-sized chunks
 */
import { urlSpans, xFitEnd, xLength } from './xLength.js'

const MAX_CHARS = 280

/**
 * Splits text into chunks that fit within the character limit (X weighted length, see xLength.js)
 * Attempts to break at word boundaries when possible, never inside a URL
 * @param {string} text - Text to split
 * @param {number} maxChars - Maximum weighted characters per chunk (default: 280)
 * @returns {string[]} - Array of text chunks
 */
export function splitIntoThreads(text, maxChars = MAX_CHARS) {
  if (!text || text.length === 0) return []

  // If text fits in one tweet, return as single chunk
  if (xLength(text) <= maxChars) {
    return [text]
  }

  const chunks = []
  let remaining = text.trim()

  while (remaining.length > 0) {
    // fit: the longest cut that weighs at most maxChars (never inside a grapheme or URL)
    const fit = xFitEnd(remaining, maxChars)
    if (fit >= remaining.length) {
      chunks.push(remaining)
      break
    }

    // Try to find a good break point (space, newline, punctuation) before fit
    let breakPoint = fit
    const searchStart = Math.max(0, fit - 50); // Look back up to 50 chars
    const spans = urlSpans(remaining)
    // A break is not allowed strictly inside a URL (a "." in a URL is not a sentence end)
    const cuts = (index) => !spans.some(({ start, end }) => index > start && index < end)

    // Look for word boundaries (spaces, newlines)
    const spaceIndex = remaining.lastIndexOf(' ', fit - 1);
    const newlineIndex = remaining.lastIndexOf('\n', fit - 1);
    const punctuationIndex = remaining.lastIndexOf('.', fit - 1);

    // Prefer newline, then space, then punctuation
    if (newlineIndex >= searchStart) {
      breakPoint = newlineIndex + 1;
    } else if (spaceIndex >= searchStart) {
      breakPoint = spaceIndex + 1;
    } else if (punctuationIndex >= searchStart && cuts(punctuationIndex + 1)) {
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
