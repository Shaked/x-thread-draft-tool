import { useEffect, useState } from 'react'
import Banner from '../../ui/Banner'
import Button from '../../ui/Button'
import CodeBlock from '../../ui/CodeBlock'
import EmptyState from '../../ui/EmptyState'
import Field from '../../ui/Field'
import Section from '../../ui/Section'
import Select from '../../ui/Select'
import Skeleton from '../../ui/Skeleton'
import Stack from '../../ui/Stack'
import Table from '../../ui/Table'
import { adminApi } from '../../utils/api'

// The rows of GET /api/admin/audit, the same data as the admin_audit_log tool (#288). The route takes `before`
// (a created_at); "Older" sends the last loaded row's time. A short page is the last one.
const PAGE = 50

const ACTIONS = ['suspend_user', 'unsuspend_user', 'delete_user', 'view_as_start', 'view_as_end']
const FILTER_OPTIONS = [{ value: 'all', label: 'All actions' }, ...ACTIONS.map((action) => ({ value: action, label: action }))]

const COLUMNS = [
  { key: 'when', label: 'Time' },
  { key: 'actor', label: 'Actor' },
  { key: 'action', label: 'Action' },
  { key: 'outcome', label: 'Outcome' },
  { key: 'target', label: 'Target login' },
  { key: 'details', label: 'Details' }
]

// "2026-11-26 10:00:00 UTC" from an ISO time (the route's created_at).
const formatTime = (iso) => `${iso.replace('T', ' ').slice(0, 19)} UTC`

function toRow(event) {
  return {
    id: event.id,
    when: formatTime(event.created_at),
    actor: event.actor_login ?? '',
    action: event.action,
    outcome: event.outcome,
    target: event.target_login ?? '',
    details: <CodeBlock code={JSON.stringify(event.details ?? {})} />
  }
}

// The admin audit log, newest first. The action filter works on the rows already loaded; no new request is sent.
export default function AdminAuditPage() {
  const [status, setStatus] = useState('loading')
  const [attempt, setAttempt] = useState(0)
  const [events, setEvents] = useState([])
  const [hasMore, setHasMore] = useState(false)
  const [olderState, setOlderState] = useState('idle')
  const [action, setAction] = useState('all')

  useEffect(() => {
    let cancelled = false
    adminApi
      .audit()
      .then((rows) => {
        if (cancelled) return
        setEvents(rows)
        setHasMore(rows.length === PAGE)
        setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [attempt])

  const loadOlder = () => {
    const last = events[events.length - 1]
    setOlderState('loading')
    adminApi
      .audit(last.created_at)
      .then((rows) => {
        setEvents((current) => [...current, ...rows])
        setHasMore(rows.length === PAGE)
        setOlderState('idle')
      })
      .catch(() => setOlderState('error'))
  }

  if (status === 'loading') return <Skeleton variant="card" lines={3} />
  if (status === 'error') {
    return (
      <Banner
        tone="danger"
        role="alert"
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setStatus('loading')
              setAttempt((count) => count + 1)
            }}
          >
            Try again
          </Button>
        }
      >
        Could not load the audit log.
      </Banner>
    )
  }

  const shown = action === 'all' ? events : events.filter((event) => event.action === action)

  return (
    <Stack gap={8}>
      <Section title="Audit log" headingLevel={2}>
        <Field label="Action" help="Filters the rows loaded on this page. No new request is sent.">
          <Select value={action} onChange={setAction} options={FILTER_OPTIONS} />
        </Field>
        {shown.length === 0 ? (
          <EmptyState
            title="No admin actions"
            description={action === 'all' ? 'Nothing has been recorded yet.' : 'No loaded row has this action.'}
          />
        ) : (
          <Table caption="Admin actions, newest first" columns={COLUMNS} rows={shown.map(toRow)} rowKey={(row) => row.id} />
        )}
        {olderState === 'error' && (
          <Banner tone="danger" role="alert">
            Could not load older rows.
          </Banner>
        )}
        {hasMore && (
          <Button variant="secondary" loading={olderState === 'loading'} onClick={loadOlder}>
            Older
          </Button>
        )}
      </Section>
    </Stack>
  )
}
