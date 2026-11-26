// Observability plan O1 (#332): the latency histogram, pure functions.
import { describe, expect, it } from 'vitest'
import { BUCKETS, MIN_SAMPLES, arrayIndex, bucketOf, merge, oneHot, percentile, summary } from '../../server/metrics/histogram.js'

const sumOf = (buckets) => buckets.reduce((a, b) => a + b, 0)

// A row as the table holds it: n, sum_ms, max_ms and the histogram of the samples.
function rowOf(samples) {
  let buckets = new Array(BUCKETS).fill(0)
  for (const ms of samples) buckets = merge(buckets, oneHot(ms))
  return { n: samples.length, sum_ms: samples.reduce((a, b) => a + b, 0), max_ms: Math.max(...samples), buckets }
}

describe('bucketOf', () => {
  it('puts the bucket edges where the plan says', () => {
    expect(bucketOf(0.5)).toBe(0)
    expect(bucketOf(1)).toBe(1)
    expect(bucketOf(1.19)).toBe(2)
    expect(bucketOf(2)).toBe(5)
    expect(bucketOf(2 ** (1 / 4))).toBe(2)
    expect(bucketOf(2 ** (62 / 4))).toBe(63)
    expect(bucketOf(2 ** (63 / 4))).toBe(64)
    expect(bucketOf(55000)).toBe(63)
    expect(bucketOf(600000)).toBe(64)
  })

  it('treats non-numbers and negatives as 0 and infinity as the last counter', () => {
    expect(bucketOf(NaN)).toBe(0)
    expect(bucketOf(-5)).toBe(0)
    expect(bucketOf(Infinity)).toBe(64)
  })

  it('never returns a counter outside 0 to 64', () => {
    for (const ms of [0, 0.0001, 1e-9, 1, 3, 1e4, 1e12]) {
      const k = bucketOf(ms)
      expect(k).toBeGreaterThanOrEqual(0)
      expect(k).toBeLessThanOrEqual(64)
    }
  })
})

describe('arrayIndex, oneHot, merge', () => {
  it('maps counter k to Postgres position k + 1 and refuses anything outside 0 to 64', () => {
    expect(arrayIndex(0)).toBe(1)
    expect(arrayIndex(64)).toBe(65)
    expect(() => arrayIndex(65)).toThrow(RangeError)
    expect(() => arrayIndex(-1)).toThrow(RangeError)
    expect(() => arrayIndex(1.5)).toThrow(RangeError)
  })

  it('oneHot is 65 elements with a single 1 at the counter of the value', () => {
    const h = oneHot(5)
    expect(h).toHaveLength(BUCKETS)
    expect(sumOf(h)).toBe(1)
    expect(h[bucketOf(5)]).toBe(1)
  })

  it('merge adds counter by counter, exactly', () => {
    const a = oneHot(5)
    const b = merge(oneHot(5), oneHot(900))
    const m = merge(a, b)
    expect(sumOf(m)).toBe(3)
    expect(m[bucketOf(5)]).toBe(2)
    expect(m[bucketOf(900)]).toBe(1)
  })

  it('merge refuses arrays that are not 65 counters', () => {
    expect(() => merge(new Array(64).fill(0), oneHot(1))).toThrow(RangeError)
  })
})

describe('percentile', () => {
  it('is null for an empty histogram', () => {
    expect(percentile(new Array(BUCKETS).fill(0), 0.5)).toBeNull()
  })

  it('uses nearest rank ceil(q * n)', () => {
    // 10 samples: one in counter 1, nine in counter 10. p10 is rank 1, p50 is rank 5.
    let h = new Array(BUCKETS).fill(0)
    h[1] = 1
    h[10] = 9
    expect(percentile(h, 0.1)).toBeCloseTo(2 ** (0.5 / 4), 9) // counter 1 middle
    expect(percentile(h, 0.5)).toBeCloseTo(2 ** (9.5 / 4), 9) // counter 10 middle
  })

  it('reports 0.5 ms for counter 0', () => {
    expect(percentile(oneHot(0.2), 0.5)).toBe(0.5)
  })

  it('is never more than the window max', () => {
    expect(percentile(oneHot(1000), 0.5, 900)).toBe(900)
  })

  it('stays within 9 % high and 8 % low of the true value for known samples', () => {
    // Samples 1 to 1000 ms, one each. The rank-r sample is exactly r ms.
    let h = new Array(BUCKETS).fill(0)
    for (let ms = 1; ms <= 1000; ms += 1) h = merge(h, oneHot(ms))
    for (const q of [0.5, 0.9, 0.95, 0.99]) {
      const truth = Math.ceil(q * 1000)
      const got = percentile(h, q, 1000)
      expect(got).toBeLessThanOrEqual(truth * 1.09)
      expect(got).toBeGreaterThanOrEqual(truth * 0.92)
    }
  })
})

describe('summary', () => {
  it('lists every name as low and returns null when there are no rows', () => {
    const s = summary([])
    expect(s.count).toBe(0)
    expect(s.mean).toBeNull()
    expect(s.max).toBeNull()
    expect(s.p50).toBeNull()
    expect(s.low_samples).toEqual(['p50', 'p90', 'p95', 'p99', 'p99_9'])
  })

  it('returns null below the minimum samples and lists the name', () => {
    const s = summary([rowOf(new Array(19).fill(10))])
    expect(s.count).toBe(19)
    expect(s.p50).toBeNull()
    expect(s.low_samples).toContain('p50')
  })

  it('shows p50 at 20 samples and lists the percentiles still below their minimum', () => {
    const s = summary([rowOf(new Array(20).fill(10))])
    expect(MIN_SAMPLES.p50).toBe(20)
    expect(s.p50).not.toBeNull()
    expect(s.p90).toBeNull()
    expect(s.low_samples).toEqual(['p90', 'p95', 'p99', 'p99_9'])
  })

  it('adds rows exactly: count, mean and max', () => {
    const s = summary([rowOf([10, 20]), rowOf([60])])
    expect(s.count).toBe(3)
    expect(s.mean).toBeCloseTo(30, 9)
    expect(s.max).toBe(60)
  })
})
