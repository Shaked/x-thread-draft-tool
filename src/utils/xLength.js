/**
 * X (Twitter) weighted length, computed locally (Opus decision for T6, #111; no twitter-text package).
 * Used by the editor counter, the splitter, POST /api/threads/split and server/draft-stats.js.
 *
 * Rules:
 * - Text is NFC-normalized first.
 * - A URL (https?:// or www. plus non-space characters; parentheses only when balanced; trailing . , ! ? ; : and
 *   quotes not counted) counts 23 flat. A ")" or ">" that closes nothing ends the URL.
 *   Gap: a bare domain such as example.com, with no scheme and no www., counts as plain text.
 * - An emoji grapheme that matches RGI_Emoji counts 2 in total (skin tones, ZWJ families and flags included).
 * - Other graphemes: each code point weighs 1 in U+0000-U+10FF, U+2000-U+200D, U+2010-U+201F and
 *   U+2032-U+2037; every other code point weighs 2.
 */
const URL_WEIGHT = 23
// The two alternatives start with different characters, so the pattern is linear (no nested quantifiers).
const URL_RE = /((?:https?:\/\/|www\.))(?:[^\s()<>]|\([^\s()<>]*\))+/gi
const URL_TRAILING = new Set(['.', ',', '!', '?', ';', ':', '"', "'"])
// Fallback for browsers without the v flag. It matches one whole emoji grapheme (a segment from Intl.Segmenter):
// regional-indicator pairs, keycaps, and pictographic sequences joined by ZWJ, with FE0F, skin tones and tag
// sequences. As in RGI_Emoji, a bare pictograph such as "©" is not an emoji: it needs FE0F or a skin tone.
const FALLBACK_PICTOGRAPH =
  '(?:\\p{Extended_Pictographic}\\uFE0F|(?![\\u{1F3FB}-\\u{1F3FF}])\\p{Emoji_Presentation}\\p{Emoji_Modifier}?|\\p{Extended_Pictographic}\\p{Emoji_Modifier})'
const FALLBACK_ELEMENT = `${FALLBACK_PICTOGRAPH}(?:[\\u{E0020}-\\u{E007E}]+\\u{E007F})?`
const FALLBACK_SOURCE = `^(?:\\p{Regional_Indicator}{2}|[#*0-9]\\uFE0F\\u20E3|${FALLBACK_ELEMENT}(?:\\u200D${FALLBACK_ELEMENT})*)$`

/**
 * Emoji matcher. Safari 16 and older throw a SyntaxError on the v flag, so they get a u-flag fallback
 * instead of failing to load this module (and with it the editor). `make` is injectable for the test.
 */
export function buildEmojiRegex(make = (source, flags) => new RegExp(source, flags)) {
  try {
    return make('^\\p{RGI_Emoji}$', 'v')
  } catch {
    return make(FALLBACK_SOURCE, 'u')
  }
}

const RGI_EMOJI = buildEmojiRegex()
const SEGMENTER = new Intl.Segmenter()

const codePointWeight = (cp) =>
  cp <= 0x10ff || (cp >= 0x2000 && cp <= 0x200d) || (cp >= 0x2010 && cp <= 0x201f) || (cp >= 0x2032 && cp <= 0x2037)
    ? 1
    : 2

// Every RGI emoji contains a code point with the Emoji property, so text without one skips the slow RGI test.
const EMOJI_CHAR = /\p{Emoji}/u

/** Weight of one grapheme. `emojiRegex` is the matcher from buildEmojiRegex (exported for the parity test). */
export function graphemeWeight(grapheme, emojiRegex = RGI_EMOJI) {
  const g = grapheme.normalize('NFC')
  if (EMOJI_CHAR.test(g) && emojiRegex.test(g)) return 2
  let weight = 0
  for (const ch of g) weight += codePointWeight(ch.codePointAt(0))
  return weight
}

/** Code-unit ranges of the URLs in text, as [start, end), in order. Trailing punctuation is not part of a URL. */
export function urlSpans(text) {
  const spans = []
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index
    let end = start + m[0].length
    while (end > start && URL_TRAILING.has(text[end - 1])) end -= 1
    // "https://." is not a URL: something must follow the scheme.
    if (end - start > m[1].length) spans.push({ start, end })
  }
  return spans
}

// Index of the first span that ends after `from` (spans are sorted and do not overlap).
function firstSpanAfter(spans, from) {
  let lo = 0
  let hi = spans.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (spans[mid].end <= from) lo = mid + 1
    else hi = mid
  }
  return lo
}

// The units of text[from, to) in order: each grapheme on its own, and each URL as one unit. Only the text
// between URLs is segmented, so a URL costs one step however long it is.
function* units(text, from, to, spans) {
  let pos = from
  for (let k = firstSpanAfter(spans, from); k < spans.length && spans[k].start < to; k += 1) {
    const { start, end } = spans[k]
    yield* graphemes(text, pos, Math.min(start, to))
    yield { end: Math.min(end, to), weight: URL_WEIGHT }
    pos = end
  }
  yield* graphemes(text, pos, to)
}

// Graphemes of text[from, to), segmented a window at a time. Segmenting costs time in the length of the
// string it is given, so a short scan of a long text must not segment all of it. A grapheme boundary depends
// on the code units around it, so a window's last few units are left out: the segments that end within
// LOOKAHEAD units of the window end are segmented again in the next window.
const WINDOW = 320
const LOOKAHEAD = 8
function* graphemes(text, from, to) {
  let pos = from
  while (pos < to) {
    let size = WINDOW
    let limit = Math.min(to, pos + size)
    let complete
    for (;;) {
      const segments = [...SEGMENTER.segment(text.slice(pos, limit))]
      complete = segments.filter(({ index, segment }) => limit === to || index + segment.length + LOOKAHEAD <= limit - pos)
      if (complete.length > 0 || limit === to) break
      size *= 2
      limit = Math.min(to, pos + size)
    }
    for (const { segment, index } of complete) {
      yield { end: pos + index + segment.length, weight: graphemeWeight(segment) }
    }
    const last = complete[complete.length - 1]
    pos += last.index + last.segment.length
  }
}

// Takes units until the next one would pass max. Returns the code-unit end of the last unit taken and
// its weight. The first unit is always taken, so a splitter always makes progress (a URL can be longer
// than a very small max).
function scan(text, from, to, max, spans) {
  let weight = 0
  let end = from
  for (const unit of units(text, from, to, spans)) {
    if (end > from && weight + unit.weight > max) break
    weight += unit.weight
    end = unit.end
  }
  return { end, weight }
}

/** X weighted length of text. */
export function xLength(text) {
  const s = String(text).normalize('NFC')
  return scan(s, 0, s.length, Infinity, urlSpans(s)).weight
}

/**
 * Code-unit index where text[from, to) must be cut so that the part before it weighs at most max. It never
 * falls inside a grapheme or a URL. Returns to when the whole range fits. `spans` is urlSpans(text), passed
 * in by a caller that cuts the same text many times.
 */
export function xFitEnd(text, max, { from = 0, to = text.length, spans = urlSpans(text) } = {}) {
  return scan(text, from, to, max, spans).end
}
