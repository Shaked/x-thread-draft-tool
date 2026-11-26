import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import Badge from '../../ui/Badge'
import Banner from '../../ui/Banner'
import Button from '../../ui/Button'
import DescriptionList from '../../ui/DescriptionList'
import { List, ListItem } from '../../ui/List'
import Section from '../../ui/Section'
import Skeleton from '../../ui/Skeleton'
import Stack from '../../ui/Stack'
import { adminApi } from '../../utils/api'

const LOGIN = /^[A-Za-z0-9-]{1,39}$/
const show = (value) => (value === null || value === undefined ? 'unknown' : value)
const when = (value) => (value ? String(value).replace('T', ' ').slice(0, 16) + ' UTC' : 'unknown')

// A token that is revoked or past its expiry cannot sign in, so it is not shown as active.
const tokenBadge = (token) =>
  token.revoked_at ? <Badge tone="danger">Revoked</Badge>
    : token.expires_at && new Date(token.expires_at) <= new Date() ? <Badge>Expired</Badge>
      : <Badge tone="success">Active</Badge>

const bytes = (n) => (n === null || n === undefined ? 'unknown' : `${n} bytes`)

// One user of GET /api/admin/users/:id, the same fields as the admin_get_user tool (#286). User text is shown as text only.
export default function AdminUserPage() {
  const { id } = useParams()
  // A new id starts a fresh page, so the loading state is the initial state.
  return <UserDetails key={id} id={id} />
}

function UserDetails({ id }) {
  const [state, setState] = useState({ status: 'loading', user: null })

  const load = () =>
    adminApi
      .user(id)
      .then((user) => setState({ status: 'ready', user }))
      .catch((err) => setState({ status: err.status === 404 ? 'missing' : 'error', user: null }))

  useEffect(() => {
    load()
  }, [])

  if (state.status === 'loading') return <Skeleton variant="card" lines={3} />
  if (state.status === 'missing') return <Banner tone="danger" role="alert">User not found.</Banner>
  if (state.status === 'error') {
    return (
      <Banner
        tone="danger"
        role="alert"
        actions={
          <Button variant="secondary" size="sm" onClick={() => { setState({ status: 'loading', user: null }); load() }}>
            Try again
          </Button>
        }
      >
        Could not load the user.
      </Banner>
    )
  }

  const { user } = state
  const imageSize = user.image_files_truncated ? `${bytes(user.image_bytes)} (list cut short)` : bytes(user.image_bytes)
  return (
    <Stack gap={8}>
      <Section title={<span dir="auto">{user.name ?? user.login}</span>} headingLevel={2}>
        <Stack gap={4}>
          <div>{user.suspended_at ? <Badge tone="danger">Suspended</Badge> : <Badge tone="success">Active</Badge>}</div>
          <DescriptionList
            columns={2}
            items={[
              { term: 'Login', value: LOGIN.test(user.login) ? <Button variant="ghost" href={`https://github.com/${user.login}`}>{user.login}</Button> : show(user.login) },
              { term: 'Name', value: <span dir="auto">{show(user.name)}</span> },
              { term: 'Protected', value: user.protected ? 'Yes' : 'No' },
              { term: 'Created', value: when(user.created_at) },
              { term: 'Last sign-in', value: when(user.last_sign_in_at) },
              { term: 'Last active', value: when(user.last_active_at) },
              { term: 'Suspended at', value: user.suspended_at ? when(user.suspended_at) : 'Not suspended' },
              { term: 'Suspended reason', value: user.suspended_at ? <span dir="auto">{show(user.suspended_reason)}</span> : 'Not suspended' },
              { term: 'Drafts', value: show(user.drafts) },
              { term: 'Published drafts', value: show(user.published_drafts) },
              { term: 'Posts', value: show(user.posts) },
              { term: 'Images', value: show(user.images) },
              { term: 'Image files', value: show(user.image_files) },
              { term: 'Image size', value: imageSize },
              { term: 'Active API tokens', value: show(user.api_tokens_active) },
              { term: 'API tokens, total', value: show(user.api_tokens_total) },
              { term: 'Connected apps', value: Array.isArray(user.connected_apps) ? user.connected_apps.length : show(user.connected_apps) },
              { term: 'Active share links', value: show(user.share_links_active) },
              { term: 'App calls, 24 hours', value: show(user.mcp_calls_24h) },
              { term: 'App calls, 7 days', value: show(user.mcp_calls_7d) }
            ]}
          />
        </Stack>
      </Section>
      <Section title="API tokens" headingLevel={2}>
        {user.api_tokens.length === 0 ? (
          <p>No API tokens.</p>
        ) : (
          <List>
            {user.api_tokens.map((token) => (
              <ListItem
                key={token.id}
                title={`Created via ${show(token.created_via)}`}
                badge={tokenBadge(token)}
                meta={[`Created ${when(token.created_at)}`, `Last used ${when(token.last_used_at)}`, `Expires ${token.expires_at ? when(token.expires_at) : 'never'}`]}
              />
            ))}
          </List>
        )}
      </Section>
      <Section title="Connected apps" headingLevel={2}>
        {user.connected_apps.length === 0 ? (
          <p>No connected apps.</p>
        ) : (
          <List>
            {user.connected_apps.map((app) => (
              <ListItem
                key={app.id}
                title={`${show(app.kind)} · ${show(app.redirect_host)}`}
                badge={app.revoked_at ? <Badge tone="danger">Revoked</Badge> : <Badge tone="success">Active</Badge>}
                meta={[`Created ${when(app.created_at)}`, `Last used ${when(app.last_used_at)}`]}
              />
            ))}
          </List>
        )}
      </Section>
    </Stack>
  )
}
