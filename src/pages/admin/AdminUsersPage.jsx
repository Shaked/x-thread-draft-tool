import { useEffect, useRef, useState } from 'react'
import Badge from '../../ui/Badge'
import Banner from '../../ui/Banner'
import Button from '../../ui/Button'
import Field from '../../ui/Field'
import Input from '../../ui/Input'
import Select from '../../ui/Select'
import Skeleton from '../../ui/Skeleton'
import Stack from '../../ui/Stack'
import Table from '../../ui/Table'
import { adminApi } from '../../utils/api'

// The server's login-prefix pattern (admin_list_users `q`).
const LOGIN_PREFIX = /^[A-Za-z0-9-]{1,39}$/

const STATUSES = [
  { value: 'all', label: 'All users' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' }
]

const COLUMNS = [
  { key: 'login', label: 'Login' },
  { key: 'name', label: 'Name' },
  { key: 'status', label: 'Status' },
  { key: 'created', label: 'Created' },
  { key: 'active', label: 'Last active' },
  { key: 'drafts', label: 'Drafts' },
  { key: 'posts', label: 'Posts' },
  { key: 'tokens', label: 'Tokens' },
  { key: 'apps', label: 'Apps' },
  { key: 'mcp', label: 'App calls, 7 days' }
]

const day = (value) => (value ? String(value).slice(0, 10) : 'unknown')

const rowOf = (user) => ({
  id: user.id,
  login: <Button variant="ghost" to={`/admin/users/${user.id}`}>{user.login}</Button>,
  name: <span dir="auto">{user.name ?? 'unknown'}</span>,
  status: user.suspended_at ? <Badge tone="danger">Suspended</Badge> : <Badge tone="success">Active</Badge>,
  created: day(user.created_at),
  active: day(user.last_active_at),
  drafts: user.drafts,
  posts: user.posts,
  tokens: user.api_tokens_active,
  apps: user.connected_apps,
  mcp: user.mcp_calls_7d
})

// The users of GET /api/admin/users, the same fields as the admin_list_users tool (#286): paging, login prefix, status.
export default function AdminUsersPage() {
  const [draft, setDraft] = useState('')
  const [filter, setFilter] = useState({ q: '', status: 'all' })
  const [state, setState] = useState({ status: 'loading', users: [], next: null })
  const [more, setMore] = useState(false)

  // Each request gets a number; an answer that is not for the latest request (an older filter) is dropped.
  const latest = useRef(0)

  const load = (cursor) => {
    const mine = ++latest.current
    return adminApi
      .users({ ...filter, cursor })
      .then((data) => {
        if (mine === latest.current) setState((old) => ({ status: 'ready', users: cursor ? [...old.users, ...data.users] : data.users, next: data.next_cursor }))
      })
      .catch(() => {
        if (mine === latest.current) setState((old) => ({ ...old, status: 'error' }))
      })
      .finally(() => {
        if (mine === latest.current) setMore(false)
      })
  }

  useEffect(() => {
    load()
  }, [filter])

  const refilter = (next) => {
    setState({ status: 'loading', users: [], next: null })
    setFilter(next)
  }

  const invalid = draft !== '' && !LOGIN_PREFIX.test(draft)
  const search = (event) => {
    event.preventDefault()
    if (!invalid) refilter({ ...filter, q: draft })
  }

  return (
    <Stack gap={6}>
      <form onSubmit={search} role="search" aria-label="Find users">
        <Stack gap={4}>
          <Field label="Login starts with" error={invalid ? 'Use 1 to 39 letters, digits or hyphens.' : undefined}>
            <Input value={draft} onChange={setDraft} maxLength={39} dir="ltr" />
          </Field>
          <Field label="Status">
            <Select value={filter.status} onChange={(status) => refilter({ ...filter, status })} options={STATUSES} />
          </Field>
          <Button type="submit" variant="secondary" disabled={invalid}>
            Search
          </Button>
        </Stack>
      </form>
      {state.status === 'loading' && <Skeleton variant="card" lines={3} />}
      {state.status === 'error' && (
        <Banner
          tone="danger"
          role="alert"
          actions={
            <Button variant="secondary" size="sm" onClick={() => { setState({ status: 'loading', users: [], next: null }); load() }}>
              Try again
            </Button>
          }
        >
          Could not load the users.
        </Banner>
      )}
      {state.status === 'ready' && (
        <>
          {state.users.length === 0 ? <p>No users match.</p> : <Table caption="Users" columns={COLUMNS} rows={state.users.map(rowOf)} rowKey={(row) => row.id} />}
          {state.next && (
            <Button variant="secondary" disabled={more} onClick={() => { setMore(true); load(state.next) }}>
              Load more
            </Button>
          )}
        </>
      )}
    </Stack>
  )
}
