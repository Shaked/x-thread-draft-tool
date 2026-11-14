/**
 * X (Twitter) weighted length, computed locally (Opus decision for T6, #111; no twitter-text package).
 * Used by the editor counter, the splitter, POST /api/threads/split and server/draft-stats.js.
 *
 * Rules:
 * - Text is NFC-normalized first.
 * - A URL (https?:// or www. plus non-space characters, trailing . , ! ? ) not counted) counts 23 flat.
 *   Gap: a bare domain such as example.com, with no scheme and no www., counts as plain text.
 * - An emoji grapheme that matches RGI_Emoji counts 2 in total (skin tones, ZWJ families and flags included).
 * - Other graphemes: each code point weighs 1 in U+0000-U+10FF, U+2000-U+200D, U+2010-U+201F and
 *   U+2032-U+2037; every other code point weighs 2.
 */
const URL_WEIGHT = 23
const URL_RE = /(?:https?:\/\/|www\.)\S*[^\s.,!?)]/gi
const RGI_EMOJI = new RegExp('^\\p{RGI_Emoji}$', 'v')
const SEGMENTER = new Intl.Segmenter()

const codePointWeight = (cp) =>
  cp <= 0x10ff || (cp >= 0x2000 && cp <= 0x200d) || (cp >= 0x2010 && cp <= 0x201f) || (cp >= 0x2032 && cp <= 0x2037)
    ? 1
    : 2

function graphemeWeight(grapheme) {
  const g = grapheme.normalize('NFC')
  if (RGI_EMOJI.test(g)) return 2
  let weight = 0
  for (const ch of g) weight += codePointWeight(ch.codePointAt(0))
  return weight
}

/** Code-unit ranges of the URLs in text, as [start, end). */
export function urlSpans(text) {
  return [...text.matchAll(URL_RE)].map((m) => ({ start: m.index, end: m.index + m[0].length }))
}

// Walks the units (graphemes, or whole URLs) and stops before the unit that would pass max.
// Returns the code-unit end of the last unit taken and its weight. The first unit is always taken,
// so a splitter always makes progress (a URL can be longer than a very small max).
function scan(text, max) {
  const spans = urlSpans(text)
  let weight = 0
  let end = 0
  let skipTo = 0
  let k = 0
  for (const { index, segment } of SEGMENTER.segment(text)) {
    if (index < skipTo) continue
    while (k < spans.length && spans[k].end <= index) k += 1
    const span = spans[k]
    let unitEnd
    let unitWeight
    if (span && span.start <= index) {
      unitEnd = span.end
      unitWeight = URL_WEIGHT
      k += 1
    } else {
      unitEnd = index + segment.length
      unitWeight = graphemeWeight(segment)
    }
    if (end > 0 && weight + unitWeight > max) break
    weight += unitWeight
    end = unitEnd
    skipTo = unitEnd
  }
  return { end, weight }
}

/** X weighted length of text. */
export function xLength(text) {
  return scan(String(text).normalize('NFC'), Infinity).weight
}

/**
 * Code-unit index where text must be cut so that the part before it weighs at most max. It never falls
 * inside a grapheme or a URL. Returns text.length when the whole text fits.
 */
export function xFitEnd(text, max) {
  return scan(text, max).end
}
