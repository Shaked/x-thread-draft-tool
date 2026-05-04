import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  hasRedirectChecked,
  markRedirectChecked,
  readLastLocation,
  readScrollPosition,
  restoreScrollWithRetries,
  saveLastLocation,
  saveScrollPosition
} from '../utils/scrollRestoration'

// Locations from which we don't want to bounce a returning user back into
// a deep page. Login/auth/preview routes are intentional landings.
const NON_DEEP_PATHS = new Set(['/'])
const SKIP_REDIRECT_PREFIXES = ['/x-thread-preview/']

function isDeepLocation(pathname) {
  if (!pathname) return false
  if (NON_DEEP_PATHS.has(pathname)) return false
  if (SKIP_REDIRECT_PREFIXES.some((p) => pathname.startsWith(p))) return false
  return true
}

export default function ScrollRestoration() {
  const location = useLocation()
  const navigate = useNavigate()
  const cancelRestoreRef = useRef(null)
  const lastPathnameRef = useRef(null)

  // One-shot redirect: when iOS PWA standalone cold-launches at start_url ('/')
  // but we have a recent deep location, return the user to it.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (hasRedirectChecked()) return
    markRedirectChecked()

    if (location.pathname !== '/') return

    const last = readLastLocation()
    if (!last) return
    if (!isDeepLocation(last.pathname)) return

    navigate(
      { pathname: last.pathname, search: last.search || '', hash: last.hash || '' },
      { replace: true }
    )
  }, [])

  // Take manual control of scroll restoration so the browser doesn't fight us.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const previous = window.history.scrollRestoration
    try {
      window.history.scrollRestoration = 'manual'
    } catch {
      // Some browsers reject the assignment; ignore.
    }
    return () => {
      try {
        window.history.scrollRestoration = previous || 'auto'
      } catch {
        // ignore
      }
    }
  }, [])

  // On every route transition: persist the previous path's scroll, remember
  // the new path as the last location, then attempt to restore scroll for
  // the new path with retries (handles spinners and async data loads).
  useEffect(() => {
    if (typeof window === 'undefined') return

    const previousPath = lastPathnameRef.current
    if (previousPath && previousPath !== location.pathname) {
      saveScrollPosition(previousPath, window.scrollY)
    }
    lastPathnameRef.current = location.pathname

    saveLastLocation(location.pathname, location.search, location.hash)

    if (cancelRestoreRef.current) {
      cancelRestoreRef.current()
      cancelRestoreRef.current = null
    }

    const targetY = readScrollPosition(location.pathname)
    if (targetY == null) {
      // No saved scroll: jump to top so route changes feel normal.
      window.scrollTo(0, 0)
      return
    }

    cancelRestoreRef.current = restoreScrollWithRetries(targetY)

    return () => {
      if (cancelRestoreRef.current) {
        cancelRestoreRef.current()
        cancelRestoreRef.current = null
      }
    }
  }, [location.pathname, location.search, location.hash])

  // Persist scroll aggressively on lifecycle events that signal iOS may
  // suspend/kill the page (visibilitychange, pagehide, beforeunload).
  // Restore on pageshow when BFCache returns us to the page.
  useEffect(() => {
    if (typeof window === 'undefined') return

    const persist = () => {
      const path = lastPathnameRef.current || window.location.pathname
      saveScrollPosition(path, window.scrollY)
      saveLastLocation(path, window.location.search, window.location.hash)
    }

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') persist()
    }

    const onPageShow = (event) => {
      const path = window.location.pathname
      // Always re-attempt restoration; whether persisted (BFCache) or not,
      // we want the saved position to win over any default.
      const targetY = readScrollPosition(path)
      if (targetY == null) return
      if (cancelRestoreRef.current) cancelRestoreRef.current()
      cancelRestoreRef.current = restoreScrollWithRetries(targetY, {
        maxAttempts: event.persisted ? 4 : 40
      })
    }

    window.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', persist)
    window.addEventListener('beforeunload', persist)
    window.addEventListener('pageshow', onPageShow)

    return () => {
      window.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', persist)
      window.removeEventListener('beforeunload', persist)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [])

  return null
}
