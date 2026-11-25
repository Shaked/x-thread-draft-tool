import { useEffect, useRef, useState } from 'react'
import { draftsApi } from './api'

// Live updates for the open editor (#363). While the page is visible, the editor asks the server whether the draft
// changed (`GET /drafts/:id` with If-None-Match, a 304 when it did not). Rate: every 4 s; every 15 s after 2 min with
// no change and no input; paused after 10 min. Hidden page: no checks. Input or a visibility change resumes.
const FAST_MS = 4000
const SLOW_MS = 15000
const SLOW_AFTER_MS = 2 * 60 * 1000
const STOP_AFTER_MS = 10 * 60 * 1000

// The "Updated ..." line: "just now" under a minute, then whole minutes.
export function updatedLabel(ms) {
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) return 'Updated just now'
  return minutes === 1 ? 'Updated 1 min ago' : `Updated ${minutes} min ago`
}

/**
 * `options` is read on every tick, so the caller can pass fresh functions:
 * - enabled: false turns checks off (no draft yet, a conflict is open, signed out)
 * - canCheck(): false while there are unsaved edits or a save is in flight; the check is skipped, not queued
 * - getVersion(): the version the editor holds; no check without one
 * - onNewer(draft): called with the server's newer draft
 * Returns `{ paused, resume }`. `resume` restarts checks after a pause.
 */
export function useDraftLive(id, options) {
  const optionsRef = useRef(options)
  useEffect(() => {
    optionsRef.current = options
  })

  // Last input or change, in ms. Set when the editor starts checking (see the effect below).
  const activityRef = useRef(0)
  const pausedRef = useRef(false)
  // Set when the page becomes visible: the next run of the effect checks at once, not after 4 s.
  const checkNowRef = useRef(false)
  const [paused, setPaused] = useState(false)
  const [epoch, setEpoch] = useState(0)
  const enabled = Boolean(options.enabled)

  // Input or a visibility change: count it as activity, and restart checks if they were paused.
  const resume = () => {
    activityRef.current = Date.now()
    if (pausedRef.current) {
      pausedRef.current = false
      setPaused(false)
      setEpoch(value => value + 1)
    }
  }

  useEffect(() => {
    if (!enabled) return undefined
    activityRef.current = Date.now()

    let timer = null
    let inFlight = false
    let stopped = false
    const isVisible = () => document.visibilityState === 'visible'
    const clear = () => {
      clearTimeout(timer)
      timer = null
    }
    const schedule = ms => {
      clear()
      if (!stopped && isVisible() && ms !== null) timer = setTimeout(tick, ms)
    }
    // The next delay, or null when the 10-minute stop has been reached (the loop pauses there).
    const delayFor = () => {
      const idle = Date.now() - activityRef.current
      if (idle >= STOP_AFTER_MS) {
        pausedRef.current = true
        setPaused(true)
        return null
      }
      return idle >= SLOW_AFTER_MS ? SLOW_MS : FAST_MS
    }

    async function tick() {
      timer = null
      if (stopped || !isVisible()) return
      const { canCheck, getVersion } = optionsRef.current
      const version = getVersion()
      if (!inFlight && version !== undefined && canCheck()) {
        inFlight = true
        try {
          const result = await draftsApi.check(id, version)
          // The state may have moved while the check was in flight: a stop, a conflict, an edit or a save
          // that took a newer version. Then this answer is stale and is dropped.
          // The options are read again: the ones read above belong to the render that started the check.
          const latest = optionsRef.current
          if (!stopped && result.changed && latest.getVersion() === version && latest.canCheck()) {
            activityRef.current = Date.now()
            latest.onNewer(result.draft)
          }
        } catch {
          // A failed check is simply tried again on the next tick.
        } finally {
          inFlight = false
        }
      }
      if (!stopped) schedule(delayFor())
    }

    const onVisibility = () => {
      if (isVisible()) {
        checkNowRef.current = true
        // A paused loop restarts through the epoch (the effect runs again and checks at once).
        if (pausedRef.current) return resume()
        activityRef.current = Date.now()
        // An in-flight check schedules the next tick when it ends; otherwise check at once.
        if (!inFlight) {
          clear()
          tick()
        }
      } else {
        clear()
      }
    }
    // Input during the slow phase brings the next check forward to the fast rate.
    const onInput = () => {
      resume()
      if (timer !== null && !inFlight) schedule(FAST_MS)
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('keydown', onInput, { capture: true, passive: true })
    window.addEventListener('pointerdown', onInput, { capture: true, passive: true })
    window.addEventListener('input', onInput, { capture: true, passive: true })
    const now = checkNowRef.current
    checkNowRef.current = false
    schedule(now ? 0 : delayFor())

    return () => {
      stopped = true
      clear()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('keydown', onInput, { capture: true })
      window.removeEventListener('pointerdown', onInput, { capture: true })
      window.removeEventListener('input', onInput, { capture: true })
    }
    // resume is recreated each render but only touches refs and stable setters.
  }, [enabled, id, epoch])

  return { paused, resume }
}
