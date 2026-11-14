// Rules for text this server writes itself (tool descriptions, instructions; later prompts and the
// skill). Plan decision D-22. Draft text and user arguments are not checked here: they stay byte-identical.
// The class is written with \u escapes so no invisible character sits in the source:
// U+200B-U+200F (zero-width and direction marks), U+202A-U+202E (bidi embedding and override),
// U+2060-U+2069 (word joiner, invisible operators, bidi isolates), U+FEFF (BOM).
const FORBIDDEN_TEXT =/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/

/** True when `s` is NFC, well-formed UTF-16 (no lone surrogate) and has no bidi or invisible format character. */
export function isCleanServerText(s) {
  return typeof s === 'string' && s === s.normalize('NFC') && Buffer.from(s, 'utf8').toString('utf8') === s && !FORBIDDEN_TEXT.test(s)
}
