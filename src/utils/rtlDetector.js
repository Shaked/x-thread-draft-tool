/**
 * Detects if text contains RTL (Right-to-Left) characters
 * Supports Arabic, Hebrew, Persian, Urdu, and other RTL languages
 */

// Unicode ranges for RTL scripts
const RTL_RANGES = [
  [0x0590, 0x05FF], // Hebrew
  [0x0600, 0x06FF], // Arabic
  [0x0700, 0x074F], // Syriac
  [0x0750, 0x077F], // Arabic Supplement
  [0x08A0, 0x08FF], // Arabic Extended-A
  [0xFB50, 0xFDFF], // Arabic Presentation Forms-A
  [0xFE70, 0xFEFF], // Arabic Presentation Forms-B
  [0x10E60, 0x10E7F], // Rumi Numeral Symbols
  [0x1EE00, 0x1EEFF], // Arabic Mathematical Alphabetic Symbols
];

/**
 * Checks if a character is an RTL character
 * @param {string} char - Single character to check
 * @returns {boolean} - True if character is RTL
 */
function isRTLChar(char) {
  const code = char.charCodeAt(0);
  return RTL_RANGES.some(([start, end]) => code >= start && code <= end);
}

/**
 * Detects if text contains RTL characters
 * @param {string} text - Text to analyze
 * @returns {boolean} - True if text contains RTL characters
 */
export function detectRTL(text) {
  if (!text || text.length === 0) return false;

  // Count RTL and LTR characters
  let rtlCount = 0;
  let ltrCount = 0;

  for (const char of text) {
    if (isRTLChar(char)) {
      rtlCount++;
    } else if (/[a-zA-Z0-9]/.test(char)) {
      ltrCount++;
    }
  }

  // If RTL characters are present and outnumber LTR, consider it RTL
  // Also consider it RTL if RTL characters make up a significant portion
  return rtlCount > 0 && rtlCount >= ltrCount * 0.3;
}

/**
 * Gets the text direction for a given text
 * @param {string} text - Text to analyze
 * @returns {'rtl'|'ltr'} - Text direction
 */
export function getTextDirection(text) {
  return detectRTL(text) ? 'rtl' : 'ltr';
}
