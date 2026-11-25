// Observability plan O1 (#332): a fixed latency histogram, pure functions only. Nothing calls it yet.
//
// Counter 0 holds requests under 1 ms. Counter k (1 to 63) holds requests from 2^((k-1)/4) ms up to
// 2^(k/4) ms. Counter 64 holds requests of 2^(63/4) ms (about 55 s) and longer. Each step is about 19 % wider.
// A JS array holds counter k at index k. Postgres arrays start at 1, so the same counter is array
// position arrayIndex(k) = k + 1 in SQL.

export const BUCKETS = 65
const LAST = BUCKETS - 1

// Samples a percentile needs before it is shown: n must be at least 10 / (1 - q).
// Keys are the response field names (p99_9 for p99.9).
export const MIN_SAMPLES = { p50: 20, p90: 100, p95: 200, p99: 1000, p99_9: 10000 }
const QUANTILES = { p50: 0.5, p90: 0.9, p95: 0.95, p99: 0.99, p99_9: 0.999 }

/** Counter (0 to 64) for a latency in milliseconds. Non-numbers and negatives count as 0. */
export function bucketOf(ms) {
  if (!(ms >= 1)) return 0
  if (ms === Infinity) return LAST
  let k = Math.min(LAST, Math.floor(4 * Math.log2(ms)) + 1)
  // log2 can round across an exact edge, so compare with the edges themselves.
  while (k > 1 && ms < 2 ** ((k - 1) / 4)) k -= 1
  while (k < LAST && ms >= 2 ** (k / 4)) k += 1
  return k
}

/** Postgres array position (1-based) of counter k. */
export function arrayIndex(k) {
  if (!Number.isInteger(k) || k < 0 || k > LAST) throw new RangeError(`counter out of range: ${k}`)
  return k + 1
}

/** A full 65-element array with one 1 at the counter of ms. */
export function oneHot(ms) {
  const buckets = new Array(BUCKETS).fill(0)
  buckets[bucketOf(ms)] = 1
  return buckets
}

/** Exact sum of two histograms, counter by counter. */
export function merge(a, b) {
  if (a.length !== BUCKETS || b.length !== BUCKETS) throw new RangeError('histogram must have 65 counters')
  return a.map((value, k) => value + b[k])
}

// Geometric middle of counter k. Counter 0 is 0.5 ms. Counter 64 has no upper edge, so it returns maxMs.
function middle(k, maxMs) {
  if (k === 0) return 0.5
  if (k === LAST) return maxMs ?? 2 ** (LAST / 4)
  return 2 ** ((k - 0.5) / 4)
}

/**
 * Nearest-rank percentile q (0 to 1) of a histogram: rank ceil(q * n), reported as the geometric middle of
 * the counter that holds that rank, never more than maxMs. Returns null for an empty histogram.
 */
export function percentile(buckets, q, maxMs = null) {
  const n = buckets.reduce((sum, value) => sum + value, 0)
  if (n === 0) return null
  const rank = Math.ceil(q * n)
  const cap = maxMs ?? Infinity
  let seen = 0
  for (let k = 0; k < BUCKETS; k += 1) {
    seen += buckets[k]
    if (seen >= rank) return Math.min(middle(k, maxMs), cap)
  }
  return null
}

/**
 * The response fields of one group, from its rows: { count, p50, p90, p95, p99, p99_9, mean, max, low_samples }.
 * Each row has n, sum_ms, max_ms and buckets. A percentile below its minimum sample count is null and its
 * name is listed in low_samples.
 */
export function summary(rows) {
  let buckets = new Array(BUCKETS).fill(0)
  let count = 0
  let sum = 0
  let max = 0
  for (const row of rows) {
    buckets = merge(buckets, row.buckets)
    count += Number(row.n)
    sum += Number(row.sum_ms)
    max = Math.max(max, Number(row.max_ms))
  }
  const out = {
    count,
    p50: null,
    p90: null,
    p95: null,
    p99: null,
    p99_9: null,
    mean: count > 0 ? sum / count : null,
    max: count > 0 ? max : null,
    low_samples: []
  }
  const maxMs = count > 0 ? max : null
  for (const [name, q] of Object.entries(QUANTILES)) {
    if (count < MIN_SAMPLES[name]) {
      out.low_samples.push(name)
    } else {
      out[name] = percentile(buckets, q, maxMs)
    }
  }
  return out
}
