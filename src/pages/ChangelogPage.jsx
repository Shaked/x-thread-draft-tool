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

/** Groups entries by their Area, in the order each Area first appears. */
function groupByArea(entries) {
  const areas = []
  for (const entry of entries) {
    const group = areas.find((item) => item.area === entry.area)
    if (group) group.entries.push(entry)
    else areas.push({ area: entry.area, entries: [entry] })
  }
  return areas
}

/** One entry: the title, the summary, the pull request link and the Technical details fold. */
function EntryCard({ entry }) {
  return (
    <article id={`changelog-${entry.id}`} tabIndex={-1}>
      <Card>
        {entry.title && <h4 dir="auto">{entry.title}</h4>}
        {entry.summary && <p dir="auto">{entry.summary}</p>}
        {entry.link && (
          <p>
            <a href={entry.link} target="_blank" rel="noopener noreferrer">
              Open the pull request
            </a>
          </p>
        )}
        {entry.details && (
          <details>
            <summary>Technical details</summary>
            <pre className="changelog-details" dir="auto">
              {entry.details}
            </pre>
          </details>
        )}
      </Card>
    </article>
  )
}

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
    // An entry without an Area sits in the closed "Earlier changes" fold: open it, or focus cannot move there.
    const entry = document.getElementById(`changelog-${focusId.current}`)
    const fold = entry?.closest('details')
    if (fold) fold.open = true
    entry?.focus()
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
              <Stack gap={5}>
                {groupByArea(entries.filter((entry) => entry.area)).map(({ area, entries: items }) => (
                  <Section key={area} title={area} headingLevel={3}>
                    <Stack gap={3}>
                      {items.map((entry) => (
                        <EntryCard key={entry.id} entry={entry} />
                      ))}
                    </Stack>
                  </Section>
                ))}
                {entries.some((entry) => !entry.area) && (
                  <details>
                    <summary>Earlier changes (original text)</summary>
                    <Stack gap={3}>
                      {entries
                        .filter((entry) => !entry.area)
                        .map((entry) => (
                          <EntryCard key={entry.id} entry={entry} />
                        ))}
                    </Stack>
                  </details>
                )}
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
