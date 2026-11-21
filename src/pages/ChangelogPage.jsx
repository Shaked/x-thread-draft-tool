import { useEffect, useRef, useState } from 'react'
import Banner from '../ui/Banner'
import Button from '../ui/Button'
import Card from '../ui/Card'
import Page from '../ui/Page'
import PageHeader from '../ui/PageHeader'
import Section from '../ui/Section'
import Skeleton from '../ui/Skeleton'
import Stack from '../ui/Stack'
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
    <Page width="narrow">
      <PageHeader
        title="Changelog"
        subtitle={`Version ${version.short}, deployed ${version.deployedAt}`}
        back={{ to: '/', label: '← Back to drafts' }}
      />

      <Stack gap={8}>
        {list.status === 'loading' && <Skeleton variant="card" lines={2} />}
        {list.status === 'error' && (
          <Banner
            tone="danger"
            role="alert"
            actions={
              <Button variant="secondary" size="sm" onClick={retry}>
                Try again
              </Button>
            }
          >
            Could not load the changelog.
          </Banner>
        )}
        {list.status === 'ready' && list.entries.length === 0 && <p>No changes yet.</p>}

        {list.status === 'ready' &&
          groupByDay(list.entries).map(({ day, entries }) => (
            <Section key={day} title={dayText.format(new Date(`${day}T00:00:00Z`))}>
              <Stack gap={3}>
                {entries.map((entry) => (
                  <article key={entry.id} id={`changelog-${entry.id}`} tabIndex={-1}>
                    <Card>
                      {entry.title && <h3 dir="auto">{entry.title}</h3>}
                      {entry.summary && <p dir="auto">{entry.summary}</p>}
                    </Card>
                  </article>
                ))}
              </Stack>
            </Section>
          ))}

        {list.status === 'ready' && list.next && (
          <Stack gap={3}>
            {olderState === 'error' && (
              <Banner tone="danger" role="alert">
                Could not load older changes.
              </Banner>
            )}
            <Button variant="secondary" onClick={showOlder} loading={olderState === 'busy'} loadingLabel="Show older">
              Show older
            </Button>
          </Stack>
        )}
      </Stack>
    </Page>
  )
}
