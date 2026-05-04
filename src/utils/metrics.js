// Production performance metrics collector.
// Sends batched events to Supabase metrics_events via PostgREST insert.
// Off-switches: localStorage['mx:off']='1' or URL param ?metrics=0.

import { onLCP, onINP, onCLS, onFCP, onTTFB } from 'web-vitals'

const SAMPLE_RATE = 1
const FLUSH_INTERVAL_MS = 60_000
const SNAPSHOT_INTERVAL_MS = 15_000
const EVICTION_THRESHOLD_MS = 30_000
const KEY_LAST_SEEN = 'mx:lastSeen'
const KEY_LAST_URL = 'mx:lastUrl'
const KEY_LAST_VISIBILITY = 'mx:lastVis'
const KEY_OFF = 'mx:off'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

let initialized = false
let disabled = false
let sessionId = null
let queue = []
let reloadContext = null
let flushTimer = null
let snapshotTimer = null
let visible = true

function uuidv4() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  const r = crypto.getRandomValues(new Uint8Array(16))
  r[6] = (r[6] & 0x0f) | 0x40
  r[8] = (r[8] & 0x3f) | 0x80
  const h = Array.from(r, b => b.toString(16).padStart(2, '0'))
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10, 16).join('')}`
}

function readLS(key) { try { return localStorage.getItem(key) } catch { return null } }
function writeLS(key, value) { try { localStorage.setItem(key, value) } catch {} }

// Strip query strings and IDs from the route. Keeps things like /draft/:id as
// /draft/[id] so aggregation groups correctly and no draft IDs leak.
function normalizePath(pathname) {
  return pathname
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[id]')
    .replace(/\/\d+(?=\/|$)/g, '/[id]')
}

function currentPath() {
  return normalizePath(location.pathname)
}

function shouldDisable() {
  if (typeof window === 'undefined') return true
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return true
  if (readLS(KEY_OFF) === '1') return true
  try {
    const params = new URLSearchParams(location.search)
    if (params.get('metrics') === '0') return true
  } catch {}
  if (Math.random() >= SAMPLE_RATE) return true
  return false
}

function buildReloadContext() {
  let navType = 'navigate'
  let bfcacheRestored = false
  try {
    const nav = performance.getEntriesByType('navigation')[0]
    if (nav && nav.type) navType = nav.type
  } catch {}

  const lastSeen = parseInt(readLS(KEY_LAST_SEEN) || '0', 10)
  const lastUrl = readLS(KEY_LAST_URL)
  const wasHiddenLast = readLS(KEY_LAST_VISIBILITY) === 'hidden'
  const timeAwayMs = lastSeen ? Date.now() - lastSeen : null

  return {
    type: navType,
    bfcacheRestored,
    lastUrl,
    timeAwayMs,
    likelyEvicted:
      navType === 'navigate' &&
      wasHiddenLast &&
      timeAwayMs !== null &&
      timeAwayMs > EVICTION_THRESHOLD_MS
  }
}

function enqueue(event_type, payload) {
  if (disabled) return
  queue.push({
    session_id: sessionId,
    event_type,
    url_path: currentPath(),
    payload: payload || {},
    user_agent: navigator.userAgent
  })
  if (queue.length >= 50) flush()
}

async function flush(opts = {}) {
  if (disabled || queue.length === 0) return
  const batch = queue
  queue = []
  const body = JSON.stringify(batch)
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/metrics_events`, {
      method: 'POST',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        Prefer: 'return=minimal'
      },
      body
    })
  } catch {
    // Drop on failure rather than retry — this is best-effort telemetry.
    if (!opts.dropOnError) {
      // Re-queue once for transient errors; cap to avoid unbounded growth.
      if (queue.length < 200) queue = batch.concat(queue)
    }
  }
}

function takeSnapshot() {
  if (!visible) return
  const snap = {
    domNodes: document.getElementsByTagName('*').length,
    deviceMemory: navigator.deviceMemory ?? null
  }
  if (performance.memory && typeof performance.memory.usedJSHeapSize === 'number') {
    snap.usedJSHeapSize = performance.memory.usedJSHeapSize
    snap.jsHeapSizeLimit = performance.memory.jsHeapSizeLimit
  }
  if (navigator.storage && navigator.storage.estimate) {
    navigator.storage.estimate().then(est => {
      snap.storageUsage = est.usage ?? null
      snap.storageQuota = est.quota ?? null
      enqueue('snapshot', snap)
    }).catch(() => enqueue('snapshot', snap))
  } else {
    enqueue('snapshot', snap)
  }
}

function onVitals(metric) {
  enqueue('vitals', {
    name: metric.name,
    value: metric.value,
    rating: metric.rating,
    delta: metric.delta,
    id: metric.id,
    navigationType: metric.navigationType
  })
}

function setupObservers() {
  try { onLCP(onVitals) } catch {}
  try { onINP(onVitals) } catch {}
  try { onCLS(onVitals) } catch {}
  try { onFCP(onVitals) } catch {}
  try { onTTFB(onVitals) } catch {}

  try {
    const po = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        enqueue('longtask', {
          duration: entry.duration,
          startTime: entry.startTime,
          name: entry.name
        })
      }
    })
    po.observe({ type: 'longtask', buffered: true })
  } catch {}
}

function setupLifecycle() {
  document.addEventListener('visibilitychange', () => {
    visible = document.visibilityState === 'visible'
    writeLS(KEY_LAST_VISIBILITY, document.visibilityState)
    writeLS(KEY_LAST_SEEN, String(Date.now()))
    if (!visible) flush({ dropOnError: true })
  })

  window.addEventListener('pagehide', () => {
    writeLS(KEY_LAST_SEEN, String(Date.now()))
    writeLS(KEY_LAST_VISIBILITY, 'hidden')
    flush({ dropOnError: true })
  })

  window.addEventListener('pageshow', e => {
    if (e.persisted) {
      reloadContext.bfcacheRestored = true
      enqueue('pageview', { ...reloadContext, replay: true })
      flush()
    }
  })

  // Keep last-seen fresh while the tab is alive so timeAwayMs is meaningful.
  setInterval(() => {
    if (visible) writeLS(KEY_LAST_SEEN, String(Date.now()))
  }, 5000)
}

export function initMetrics() {
  if (initialized) return
  initialized = true
  disabled = shouldDisable()
  if (disabled) return

  sessionId = uuidv4()
  reloadContext = buildReloadContext()

  writeLS(KEY_LAST_URL, location.href)
  writeLS(KEY_LAST_SEEN, String(Date.now()))
  writeLS(KEY_LAST_VISIBILITY, document.visibilityState || 'visible')

  enqueue('pageview', { ...reloadContext })

  setupObservers()
  setupLifecycle()

  takeSnapshot()
  snapshotTimer = setInterval(takeSnapshot, SNAPSHOT_INTERVAL_MS)
  flushTimer = setInterval(() => flush(), FLUSH_INTERVAL_MS)
}

export function markEvent(name, data) {
  enqueue('custom', { name, ...(data || {}) })
}

export function getReloadContext() {
  return reloadContext ? { ...reloadContext } : null
}
