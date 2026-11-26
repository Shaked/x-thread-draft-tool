import { useEffect, useState } from 'react'
import LineChart from '../../components/admin/LineChart'
import Banner from '../../ui/Banner'
import Button from '../../ui/Button'
import DescriptionList from '../../ui/DescriptionList'
import Section from '../../ui/Section'
import SegmentedControl from '../../ui/SegmentedControl'
import Skeleton from '../../ui/Skeleton'
import Stack from '../../ui/Stack'
import Table from '../../ui/Table'
import { adminApi } from '../../utils/api'
import DeliverySection from './DeliverySection'

const WINDOWS = [
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' }
]

// Samples a percentile needs before it is shown (the same numbers as MIN_SAMPLES in server/metrics/histogram.js).
const NEEDS = { p50: 20, p90: 100, p95: 200, p99: 1000, p99_9: 10000 }
const PERCENTILES = [
  ['p50', 'p50'],
  ['p90', 'p90'],
  ['p95', 'p95'],
  ['p99', 'p99'],
  ['p99_9', 'p99.9']
]
const PRODUCT = [
  ['signups', 'Signups'],
  ['drafts_created', 'Drafts created'],
  ['share_links_created', 'Share links'],
  ['tokens_created', 'API tokens']
]

const ms = (value, name) => (value === null ? `– (needs ${NEEDS[name]} samples)` : `${Math.round(value * 10) / 10} ms`)
const share = (m) => (m.count ? `${Math.round((m.errors['5xx'] / m.count) * 1000) / 10}%` : '0%')

const COLUMNS = (first) => [
  { key: 'name', label: first },
  { key: 'count', label: 'Requests' },
  { key: 'e4', label: '4xx' },
  { key: 'e429', label: '429' },
  { key: 'e5', label: '5xx' },
  ...PERCENTILES.map(([key, label]) => ({ key, label }))
]

function row(name, m) {
  return {
    name,
    count: m.count,
    e4: m.errors['4xx'],
    e429: m.errors['429'],
    e5: m.errors['5xx'],
    ...Object.fromEntries(PERCENTILES.map(([key]) => [key, ms(m[key], key)]))
  }
}

// The admin metrics page (#337): GET /api/admin/metrics and /series, the same numbers as the admin_metrics tools.
export default function AdminMetricsPage() {
  const [span, setSpan] = useState('24h')
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState({ status: 'loading' })

  useEffect(() => {
    let current = true
    Promise.all([
      adminApi.metrics(span, 'total'),
      adminApi.metrics(span, 'route'),
      adminApi.metrics(span, 'op'),
      adminApi.metricsSeries('requests', span),
      ...PRODUCT.map(([key]) => adminApi.metricsSeries(key, '30d'))
    ])
      .then(
        ([total, routes, ops, requests, ...product]) =>
          current &&
          setState({
            status: 'ready',
            total,
            routes,
            ops,
            requests,
            product
          })
      )
      .catch(() => current && setState({ status: 'error' }))
    return () => {
      current = false
    }
  }, [span, attempt])

  const change = (value) => {
    setState({ status: 'loading' })
    setSpan(value)
  }

  // The window switch stays on screen while the numbers load or fail, so keyboard focus is not lost when it changes.
  const windowSwitch = <SegmentedControl legend="Time window" value={span} options={WINDOWS} onChange={change} />
  if (state.status === 'loading') {
    return (
      <Stack gap={8}>
        {windowSwitch}
        <Skeleton variant="card" lines={3} />
      </Stack>
    )
  }
  if (state.status === 'error') {
    return (
      <Stack gap={8}>
        {windowSwitch}
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
          Could not load the metrics.
        </Banner>
      </Stack>
    )
  }

  const all = state.total.metrics[0] ?? {
    count: 0,
    errors: { '4xx': 0, 429: 0, '5xx': 0 },
    p95: null,
    p99: null,
    p99_9: null
  }
  const tools = state.ops.metrics.filter((m) => m.group.op.startsWith('tool:'))
  const points = state.requests.points
  // Each product series is matched by its UTC day, so a series cached a minute earlier cannot shift the rows.
  const byDay = state.product.map((s) => new Map(s.points.map((p) => [p.at.slice(0, 10), p.value])))
  const days = [...new Set(byDay.flatMap((m) => [...m.keys()]))].sort().reverse()
  const productRows = days.map((day) => ({
    day,
    ...Object.fromEntries(PRODUCT.map(([key], k) => [key, byDay[k].get(day) ?? '–']))
  }))

  return (
    <Stack gap={8}>
      {windowSwitch}
      <Section title="All routes" headingLevel={2}>
        <DescriptionList
          columns={2}
          items={[
            { term: 'Requests', value: all.count },
            { term: '5xx share', value: share(all) },
            { term: 'p95', value: ms(all.p95, 'p95') },
            { term: 'p99', value: ms(all.p99, 'p99') },
            { term: 'p99.9', value: ms(all.p99_9, 'p99_9') }
          ]}
        />
      </Section>
      <Section title={`Requests and p95 per ${state.requests.grain}`} headingLevel={2}>
        <LineChart
          labels={points.map((p) => p.at.slice(0, 16).replace('T', ' '))}
          title={`Requests and p95 per ${state.requests.grain}, ${points.length} points`}
          firstLabel={points[0]?.at.slice(0, 16).replace('T', ' ')}
          lastLabel={points[points.length - 1]?.at.slice(0, 16).replace('T', ' ')}
          series={[
            {
              key: 'requests',
              label: 'Requests',
              unit: 'requests',
              values: points.map((p) => p.value)
            },
            {
              key: 'p95',
              label: 'p95',
              unit: 'ms',
              values: points.map((p) => p.p95)
            }
          ]}
        />
      </Section>
      <Section title="By route" headingLevel={2}>
        <Table
          caption="Requests and times by route"
          columns={COLUMNS('Route')}
          rows={state.routes.metrics.map((m) => row(m.group.route, m))}
        />
      </Section>
      <Section title="By tool" headingLevel={2}>
        <Table caption="Requests and times by tool" columns={COLUMNS('Tool')} rows={tools.map((m) => row(m.group.op.slice(5), m))} />
      </Section>
      <Section title="Product" headingLevel={2}>
        <Table
          caption="Product numbers per day, last 30 days (UTC)"
          columns={[{ key: 'day', label: 'Day' }, ...PRODUCT.map(([key, label]) => ({ key, label }))]}
          rows={productRows}
        />
      </Section>
      <DeliverySection />
    </Stack>
  )
}
