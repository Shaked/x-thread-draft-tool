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

  // Positions are indexes into text, so nothing is copied per chunk and the URL spans are found once.
  const chunks = []
  const spans = urlSpans(text)
  const end = text.trimEnd().length
  let start = text.length - text.trimStart().length

  while (start < end) {
    // fit: the longest cut that weighs at most maxChars (never inside a grapheme or URL)
    const fit = xFitEnd(text, maxChars, { from: start, to: end, spans })
    if (fit >= end) {
      chunks.push(text.slice(start, end))
      break
    }

    // Try to find a good break point (space, newline, punctuation) before fit
    let breakPoint = fit
    const searchStart = Math.max(start, fit - 50) // Look back up to 50 chars
    // A break is not allowed strictly inside a URL (a "." in a URL is not a sentence end)
    const cuts = (index) => !spans.some((span) => index > span.start && index < span.end)

    // Look for word boundaries (spaces, newlines) and sentence ends, in the look-back window only, so a
    // long run without them costs one window per chunk, not the whole rest of the text
    const window = text.slice(searchStart, fit)
    const spaceIndex = window.lastIndexOf(' ') + searchStart
    const newlineIndex = window.lastIndexOf('\n') + searchStart
    const punctuationIndex = window.lastIndexOf('.') + searchStart

    // Prefer newline, then space, then punctuation
    if (newlineIndex >= searchStart) {
      breakPoint = newlineIndex + 1
    } else if (spaceIndex >= searchStart) {
      breakPoint = spaceIndex + 1
    } else if (punctuationIndex >= searchStart && cuts(punctuationIndex + 1)) {
      breakPoint = punctuationIndex + 1
    }

    // Extract chunk and move on past the whitespace that follows it
    const chunk = text.slice(start, breakPoint).trim()
    if (chunk.length > 0) {
      chunks.push(chunk)
    }
    start = breakPoint
    while (start < end && /\s/.test(text[start])) start += 1
  }

  return chunks
}
