import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import AppBar from '../components/AppBar'
import AppMenu from '../components/AppMenu'
import { changelogApi } from '../utils/api'
import { formatVersion, localBuildInfo } from '../utils/version'

const dayText = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' })

/** Groups entries (newest first) by their UTC day, keeping their order. */
function groupByDay(entries) {
  const days = []
  for (const entry of entries) {
    const day = entry.date.slice(0, 10)
    const last = days.at(-1)
    if (last?.day === day) last.entries.push(entry)
    else days.push({ day, entries: [entry] })
  }
  return days
}

// The changelog (settings-menu.md M15, Task 6): the running version, then the entries by day, 20 at a time.
export default function ChangelogPage() {
  const version = formatVersion(localBuildInfo(), new Date())
  const [list, setList] = useState({ status: 'loading', entries: [], next: null })
  const [olderState, setOlderState] = useState('idle') // idle | busy | error
  // The id of the first entry added by "Show older"; focus moves there once it is rendered.
  const focusId = useRef(null)

  // Loads the first page. State changes only in the callbacks, so the effect below sets nothing synchronously.
  const fetchFirst = () =>
    changelogApi
      .list()
      .then((page) => setList({ status: 'ready', entries: page.entries, next: page.next }))
      .catch(() => setList({ status: 'error', entries: [], next: null }))

  const retry = () => {
    setList({ status: 'loading', entries: [], next: null })
    fetchFirst()
  }

  useEffect(() => {
    fetchFirst()
  }, [])

  useEffect(() => {
    if (!focusId.current) return
    document.getElementById(`changelog-${focusId.current}`)?.focus()
    focusId.current = null
  }, [list.entries])

  const showOlder = () => {
    setOlderState('busy')
    changelogApi
      .list({ before: list.next })
      .then((page) => {
        focusId.current = page.entries[0]?.id ?? null
        setList((prev) => ({ ...prev, entries: [...prev.entries, ...page.entries], next: page.next }))
        setOlderState('idle')
      })
      .catch(() => setOlderState('error'))
  }

  return (
    <div className="tokens-page changelog-page">
      <div className="settings-top">
        <span className="page-title">
          <AppMenu />
          <Link to="/">← Back to drafts</Link>
        </span>
        <AppBar />
      </div>

      <h1>Changelog</h1>
      <p className="changelog-version">
        Version {version.short}, deployed {version.deployedAt}
      </p>

      {list.status === 'loading' && <div className="loading">Loading…</div>}
      {list.status === 'error' && (
        <div className="error" role="alert">
          <p>Could not load the changelog.</p>
          <button type="button" className="copy-btn" onClick={retry}>
            Try again
          </button>
        </div>
      )}
      {list.status === 'ready' && list.entries.length === 0 && <p className="changelog-empty">No changes yet.</p>}

      {list.status === 'ready' &&
        groupByDay(list.entries).map(({ day, entries }) => (
          <section key={day} className="changelog-day" aria-labelledby={`changelog-day-${day}`}>
            <h2 id={`changelog-day-${day}`}>{dayText.format(new Date(`${day}T00:00:00Z`))}</h2>
            {entries.map((entry) => (
              <article key={entry.id} id={`changelog-${entry.id}`} tabIndex={-1} className="changelog-entry">
                {entry.title && <h3 dir="auto">{entry.title}</h3>}
                {entry.summary && <p dir="auto">{entry.summary}</p>}
              </article>
            ))}
          </section>
        ))}

      {list.status === 'ready' && list.next && (
        <div className="changelog-more">
          {olderState === 'error' && (
            <p className="error" role="alert">
              Could not load older changes.
            </p>
          )}
          <button type="button" className="copy-btn" onClick={showOlder} disabled={olderState === 'busy'}>
            Show older
          </button>
        </div>
      )}
    </div>
  )
}
