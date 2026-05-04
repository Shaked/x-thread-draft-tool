// Persist scroll position and last visited path so iOS PWA cold-restarts
// (which jump back to the manifest's start_url) and Safari tab discards
// can be recovered transparently.

const SCROLL_KEY_PREFIX = 'xtdt:scroll:'
const LAST_LOCATION_KEY = 'xtdt:lastLocation'
const REDIRECT_GUARD_KEY = 'xtdt:redirectChecked'

// Drop persisted entries older than this; covers a couple of work sessions
// without leaving stale jumps lying around forever.
export const DEFAULT_TTL_MS = 1000 * 60 * 60 * 6

function safeStorage(getStorage) {
  try {
    const storage = getStorage()
    if (!storage) return null
    const probeKey = '__xtdt_probe__'
    storage.setItem(probeKey, '1')
    storage.removeItem(probeKey)
    return storage
  } catch {
    return null
  }
}

function getLocal() {
  if (typeof window === 'undefined') return null
  return safeStorage(() => window.localStorage)
}

function getSession() {
  if (typeof window === 'undefined') return null
  return safeStorage(() => window.sessionStorage)
}

function readEntry(storage, key) {
  if (!storage) return null
  const raw = storage.getItem(key)
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    storage.removeItem(key)
    return null
  }
}

function writeEntry(storage, key, value) {
  if (!storage) return
  try {
    storage.setItem(key, JSON.stringify(value))
  } catch {
    // Quota or private mode; nothing actionable.
  }
}

function isFresh(entry, ttl) {
  if (!entry || typeof entry.savedAt !== 'number') return false
  return Date.now() - entry.savedAt <= ttl
}

export function scrollKey(pathname) {
  return `${SCROLL_KEY_PREFIX}${pathname || '/'}`
}

export function saveScrollPosition(pathname, y = window.scrollY) {
  const key = scrollKey(pathname)
  const entry = { y: Math.max(0, Math.floor(y)), savedAt: Date.now() }
  writeEntry(getSession(), key, entry)
  writeEntry(getLocal(), key, entry)
}

export function readScrollPosition(pathname, ttl = DEFAULT_TTL_MS) {
  const key = scrollKey(pathname)
  const session = readEntry(getSession(), key)
  if (isFresh(session, ttl)) return session.y
  const local = readEntry(getLocal(), key)
  if (isFresh(local, ttl)) return local.y
  return null
}

export function clearScrollPosition(pathname) {
  const key = scrollKey(pathname)
  getSession()?.removeItem(key)
  getLocal()?.removeItem(key)
}

export function saveLastLocation(pathname, search = '', hash = '') {
  const entry = {
    pathname: pathname || '/',
    search: search || '',
    hash: hash || '',
    savedAt: Date.now()
  }
  writeEntry(getSession(), LAST_LOCATION_KEY, entry)
  writeEntry(getLocal(), LAST_LOCATION_KEY, entry)
}

export function readLastLocation(ttl = DEFAULT_TTL_MS) {
  const session = readEntry(getSession(), LAST_LOCATION_KEY)
  if (isFresh(session, ttl)) return session
  const local = readEntry(getLocal(), LAST_LOCATION_KEY)
  if (isFresh(local, ttl)) return local
  return null
}

export function markRedirectChecked() {
  const session = getSession()
  if (!session) return
  try {
    session.setItem(REDIRECT_GUARD_KEY, '1')
  } catch {
    // ignore
  }
}

export function hasRedirectChecked() {
  const session = getSession()
  if (!session) return false
  try {
    return session.getItem(REDIRECT_GUARD_KEY) === '1'
  } catch {
    return false
  }
}

// Try to scroll repeatedly while the page is hydrating async content
// (loading spinners, async fetches). Stops once we land within tolerance
// or content can't grow tall enough to fit the target.
export function restoreScrollWithRetries(targetY, options = {}) {
  if (typeof window === 'undefined') return () => {}

  const {
    maxAttempts = 40,
    intervalMs = 50,
    tolerance = 4
  } = options

  let attempts = 0
  let timer = null
  let cancelled = false

  const attempt = () => {
    if (cancelled) return
    attempts += 1

    const maxScroll = Math.max(
      0,
      (document.documentElement?.scrollHeight || 0) - window.innerHeight
    )
    const desired = Math.min(targetY, maxScroll)

    window.scrollTo(0, desired)

    // Only finish when we actually reached the requested target (within
    // tolerance) or the page is tall enough that we won't gain ground by
    // retrying. Comparing against `desired` would falsely succeed on the
    // first paint of a short loading screen.
    const reached = Math.abs(window.scrollY - targetY) <= tolerance
    const pageTallEnough = maxScroll >= targetY

    if (reached || pageTallEnough || attempts >= maxAttempts) {
      return
    }

    timer = window.setTimeout(attempt, intervalMs)
  }

  attempt()

  return () => {
    cancelled = true
    if (timer != null) window.clearTimeout(timer)
  }
}
