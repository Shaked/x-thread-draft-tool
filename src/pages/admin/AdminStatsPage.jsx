import { useEffect, useState } from 'react'
import Banner from '../../ui/Banner'
import Button from '../../ui/Button'
import DescriptionList from '../../ui/DescriptionList'
import Section from '../../ui/Section'
import Skeleton from '../../ui/Skeleton'
import Stack from '../../ui/Stack'
import Table from '../../ui/Table'
import { adminApi } from '../../utils/api'

const TOTALS = [
  ['users', 'Users'],
  ['users_suspended', 'Suspended users'],
  ['drafts', 'Drafts'],
  ['published_drafts', 'Published drafts'],
  ['posts', 'Posts'],
  ['images', 'Images'],
  ['api_tokens_active', 'Active API tokens'],
  ['connected_apps', 'Connected apps'],
  ['share_links_active', 'Active share links'],
  ['mcp_calls_24h', 'App calls, 24 hours'],
  ['mcp_calls_7d', 'App calls, 7 days']
]

const SIGNUP_COLUMNS = [
  { key: 'day', label: 'Day (UTC)' },
  { key: 'signups', label: 'Signups' }
]

// The numbers of GET /api/admin/stats, the same as the admin_stats tool (#285): totals, active users, signups per day.
export default function AdminStatsPage() {
  const [state, setState] = useState({ status: 'loading', stats: null })

  const load = () =>
    adminApi
      .stats()
      .then((stats) => setState({ status: 'ready', stats }))
      .catch(() => setState({ status: 'error', stats: null }))

  const retry = () => {
    setState({ status: 'loading', stats: null })
    load()
  }

  useEffect(() => {
    load()
  }, [])

  if (state.status === 'loading') return <Skeleton variant="card" lines={3} />
  if (state.status === 'error') {
    return (
      <Banner
        tone="danger"
        role="alert"
        actions={
          <Button variant="secondary" size="sm" onClick={retry}>
            Try again
          </Button>
        }
      >
        Could not load the statistics.
      </Banner>
    )
  }

  const { stats } = state
  return (
    <Stack gap={8}>
      <Section title="Statistics" headingLevel={2}>
        <DescriptionList
          columns={2}
          items={[
            { term: 'Active users, 24 hours', value: stats.active_users_24h },
            { term: 'Active users, 7 days', value: stats.active_users_7d },
            ...TOTALS.map(([key, term]) => ({ term, value: stats[key] }))
          ]}
        />
      </Section>
      <Section title="Signups per day" headingLevel={2}>
        <Table caption="Signups in the last 30 days" columns={SIGNUP_COLUMNS} rows={[...stats.signups_by_day].reverse()} />
      </Section>
    </Stack>
  )
}
