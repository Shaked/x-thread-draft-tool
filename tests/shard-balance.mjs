// Pure helpers that decide which shard runs which test file (#634). No file access here: the sequencer reads the
// tables, and the refresh scripts write them. Everything is deterministic: ties go by name, then by shard number.

const byKey = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
const load = (bin) => bin.reduce((total, item) => total + item.ms, 0)

/**
 * Puts {key, ms} items into `count` bins. Items named in `pinned` ({key: shard number, 1-based}) stay in their bin;
 * the others go slowest first, each to the bin with the least time so far (ties: lowest shard number).
 * Editing one time, or adding or removing one file, therefore moves no other pinned file.
 */
export function placeItems(items, count, pinned = {}) {
  const bins = Array.from({ length: count }, () => [])
  const free = []
  for (const item of items) {
    const shard = pinned[item.key]
    if (Number.isInteger(shard) && shard >= 1 && shard <= count) bins[shard - 1].push(item)
    else free.push(item)
  }
  free.sort((a, b) => b.ms - a.ms || byKey(a, b))
  for (const item of free) {
    let target = 0
    let least = load(bins[0])
    for (let index = 1; index < count; index++) {
      const total = load(bins[index])
      if (total < least) [target, least] = [index, total]
    }
    bins[target].push(item)
  }
  return bins
}

/**
 * Lowers the heaviest bin by moving one item, or swapping two items, between it and another bin, as long as that
 * shrinks the larger of the two bins. Stops at `maxMoves` moves, when nothing helps, or when the heaviest and the
 * lightest bin are within `slack` (a fraction of the mean) of each other. Returns the bins and the number of items
 * that changed bin. Among equal results the smallest items and the earliest names move.
 */
export function rebalance(bins, maxMoves = Infinity, slack = 0) {
  const next = bins.map((bin) => [...bin])
  let moved = 0
  while (moved < maxMoves) {
    const totals = next.map(load)
    const heavy = totals.indexOf(Math.max(...totals))
    const mean = totals.reduce((a, b) => a + b, 0) / totals.length
    if (totals[heavy] - Math.min(...totals) <= slack * mean) break
    let best = null
    for (let other = 0; other < next.length; other++) {
      if (other === heavy) continue
      const gapLimit = Math.max(totals[heavy], totals[other])
      const consider = (out, back) => {
        const delta = out.ms - (back?.ms ?? 0)
        const worst = Math.max(totals[heavy] - delta, totals[other] + delta)
        if (worst >= gapLimit) return
        const candidate = { worst, other, out, back, cost: out.ms + (back?.ms ?? 0) }
        const better =
          best === null ||
          candidate.worst < best.worst ||
          (candidate.worst === best.worst &&
            (candidate.cost < best.cost ||
              (candidate.cost === best.cost && byKey(candidate.out, best.out) < 0)))
        if (better) best = candidate
      }
      for (const out of next[heavy]) {
        consider(out, null)
        for (const back of next[other]) if (back.ms < out.ms) consider(out, back)
      }
    }
    if (best === null) break
    next[heavy] = next[heavy].filter((item) => item !== best.out).concat(best.back ? [best.back] : [])
    next[best.other] = next[best.other].filter((item) => item !== best.back).concat([best.out])
    moved += best.back ? 2 : 1
  }
  return { bins: next, moved }
}

/** The assignment table for `count` shards: {shards, files: {key: shard}}. Keeps `previous` where it can. */
export const SLACK = 0.01
export function buildAssignment(timings, count, previous = {}, fallbackMs = 0) {
  const items = Object.keys(timings)
    .sort()
    .map((key) => ({ key, ms: timings[key] ?? fallbackMs }))
  const { bins } = rebalance(placeItems(items, count, previous), Infinity, SLACK)
  const files = {}
  bins.forEach((bin, index) => {
    for (const item of [...bin].sort(byKey)) files[item.key] = index + 1
  })
  return { shards: count, files }
}
