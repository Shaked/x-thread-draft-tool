// The app's version for the menu and the About page (docs/plans/settings-menu.md M16, Task 4).
// `info` is { commit, deployed_at } from the build (`__BUILD_INFO__`) or from GET /api/version.

const UNITS = [
  ['year', 60 * 60 * 24 * 365],
  ['month', 60 * 60 * 24 * 30],
  ['day', 60 * 60 * 24],
  ['hour', 60 * 60],
  ['minute', 60],
  ['second', 1]
]
const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

/** The build this client was made from, or null in tests and before the first build. */
export function localBuildInfo() {
  return typeof __BUILD_INFO__ === 'undefined' ? null : __BUILD_INFO__
}

function parseDate(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** "2026-11-18 07:46:19 UTC", or "unknown". */
export function utcText(value) {
  const date = parseDate(value)
  return date ? `${date.toISOString().slice(0, 19).replace('T', ' ')} UTC` : 'unknown'
}

/** { short, deployedAt, ago }: the commit (7 characters), the local deploy time and how long ago it was. */
export function formatVersion(info, now = new Date()) {
  const short = info?.commit ? info.commit.slice(0, 7) : 'unknown'
  const deployed = parseDate(info?.deployed_at)
  if (!deployed) return { short, deployedAt: 'unknown', ago: 'unknown' }

  const deployedAt = deployed.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' })
  const seconds = Math.max(0, Math.floor((now.getTime() - deployed.getTime()) / 1000))
  const found = UNITS.find(([, size]) => seconds >= size)
  const ago = found ? relative.format(-Math.floor(seconds / found[1]), found[0]) : relative.format(0, 'second')
  return { short, deployedAt, ago }
}
