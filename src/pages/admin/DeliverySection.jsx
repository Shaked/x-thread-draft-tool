import { useEffect, useState } from 'react'
import Banner from '../../ui/Banner'
import Button from '../../ui/Button'
import DescriptionList from '../../ui/DescriptionList'
import { List, ListItem } from '../../ui/List'
import Section from '../../ui/Section'
import SegmentedControl from '../../ui/SegmentedControl'
import Skeleton from '../../ui/Skeleton'
import Stack from '../../ui/Stack'
import Table from '../../ui/Table'
import { adminApi } from '../../utils/api'

// The "Delivery and CI" section of /admin/metrics (#452): the summary lines and the events of /api/admin/metrics.
const WINDOWS = [
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' }
]
const HOURS = { '24h': 24, '7d': 168 }

const time = (ms) => {
  if (ms === null || ms === undefined) return '–'
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s} s` : s % 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${Math.floor(s / 60)} min`
}
// "now, last week X": the second value is the same measure for the 7 days before the window.
const pair = (now, before, show = String) => `${now === null ? '–' : show(now)} (last week ${before === null || before === undefined ? '–' : show(before)})`
const seconds = (value) => (value === null ? null : value * 1000)

export default function DeliverySection() {
  const [span, setSpan] = useState('24h')
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState({ status: 'loading' })

  useEffect(() => {
    let current = true
    const since = new Date(Date.now() - HOURS[span] * 3600 * 1000).toISOString()
    Promise.all([adminApi.metricsSummary(span), adminApi.metricsEvents(since)])
      .then(([summary, events]) => current && setState({ status: 'ready', summary, events }))
      .catch(() => current && setState({ status: 'error' }))
    return () => {
      current = false
    }
  }, [span, attempt])

  const change = (value) => {
    setState({ status: 'loading' })
    setSpan(value)
  }
  const windowSwitch = <SegmentedControl legend="Delivery window" value={span} options={WINDOWS} onChange={change} />

  let body
  if (state.status === 'loading') body = <Skeleton variant="card" lines={3} />
  else if (state.status === 'error') {
    body = (
      <Banner
        tone="danger"
        role="alert"
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setState({ status: 'loading' })
              setAttempt(attempt + 1)
            }}
          >
            Try again
          </Button>
        }
      >
        Could not load the delivery numbers.
      </Banner>
    )
  } else {
    const find = (area) => state.summary.findings.find((f) => f.area === area)
    const ci = find('ci')
    const speed = find('speed')
    const deploys = find('deploys')
    const stats = ci.ci
    const items = [
      { term: 'CI time, median', value: pair(stats?.median_ms ?? null, stats?.baseline_median_ms, time) },
      { term: 'CI time, p90', value: pair(stats?.p90_ms ?? null, stats?.baseline_p90_ms, time) },
      { term: 'Push to production, p90', value: pair(seconds(speed.value), seconds(speed.baseline), time) },
      { term: 'Deploy to live, median', value: pair(seconds(deploys.value), seconds(deploys.baseline), time) },
      { term: 'CI failures', value: pair(ci.value, ci.baseline, (v) => `${v} %`) },
      { term: 'Flaky retries (share of runs)', value: pair(stats?.flaky_pct ?? null, stats?.baseline_flaky_pct, (v) => `${v} %`) }
    ]
    const lines = state.summary.text.split('\n').filter((line) => !line.startsWith('Metrics summary'))
    body = (
      <Stack gap={6}>
        <DescriptionList columns={2} items={items} />
        <List>
          {lines.map((line) => (
            <ListItem key={line} title={line.replace(/^- /, '')} />
          ))}
        </List>
        <Table
          caption="Delivery events, newest first"
          columns={[
            { key: 'at', label: 'Time (UTC)' },
            { key: 'source', label: 'Source' },
            { key: 'name', label: 'Name' },
            { key: 'status', label: 'Status' },
            { key: 'took', label: 'Time taken' },
            { key: 'link', label: 'Link' }
          ]}
          rowKey={(row) => row.key}
          rows={state.events.events.map((e) => ({
            key: `${e.source}/${e.kind}/${e.id}`,
            at: e.at.slice(0, 16).replace('T', ' '),
            source: e.source,
            name: e.name,
            status: e.status,
            took: time(e.ms),
            link: e.link ? (
              <Button variant="ghost" size="sm" href={e.link}>
                Open
              </Button>
            ) : (
              '–'
            )
          }))}
        />
        <Button variant="ghost" href={speed.link}>
          Older history: speed-metrics workflow runs
        </Button>
      </Stack>
    )
  }

  return (
    <Section title="Delivery and CI" headingLevel={2} actions={windowSwitch}>
      {body}
    </Section>
  )
}
