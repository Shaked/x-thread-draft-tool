import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Badge from '../../ui/Badge'
import Banner from '../../ui/Banner'
import ConfirmLoginDialog from '../../components/admin/ConfirmLoginDialog'
import Button from '../../ui/Button'
import DescriptionList from '../../ui/DescriptionList'
import { List, ListItem } from '../../ui/List'
import Field from '../../ui/Field'
import Inline from '../../ui/Inline'
import Input from '../../ui/Input'
import Section from '../../ui/Section'
import Skeleton from '../../ui/Skeleton'
import Stack from '../../ui/Stack'
import Dialog from '../../ui/Dialog'
import { useToast } from '../../ui/Toast'
import { adminApi } from '../../utils/api'

const LOGIN = /^[A-Za-z0-9-]{1,39}$/
const show = (value) => (value === null || value === undefined ? 'unknown' : value)
const when = (value) => (value ? String(value).replace('T', ' ').slice(0, 16) + ' UTC' : 'unknown')

// A token that is revoked or past its expiry cannot sign in, so it is not shown as active.
const tokenBadge = (token) =>
  token.revoked_at ? <Badge tone="danger">Revoked</Badge>
    : token.expires_at && new Date(token.expires_at) <= new Date() ? <Badge>Expired</Badge>
      : <Badge tone="success">Active</Badge>

const DELETE_WAIT_MS = 10 * 60 * 1000
const COUNT_TERMS = [
  ['drafts', 'Drafts'],
  ['share_links', 'Share links'],
  ['api_tokens', 'API tokens'],
  ['connected_apps', 'Connected apps'],
  ['oauth_tokens', 'App tokens'],
  ['mcp_rate_rows', 'Rate rows']
]

// The server's own message, or a plain one when the server did not answer.
const messageOf = (err) => err?.message || 'The server did not answer. Try again.'

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

  const reload = () => {
    setState({ status: 'loading', user: null })
    load()
  }

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
      {!user.protected && <UserActions user={user} onChanged={reload} />}
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

// Suspend, unsuspend and delete (#287). Every real call goes out from a dialog's confirm button, with the typed login.
function UserActions({ user, onChanged }) {
  // The open confirmation: { kind: 'suspend' | 'unsuspend' | 'delete', dry? }. The delete confirm token lives only here.
  const [dialog, setDialog] = useState(null)
  const [viewing, setViewing] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const toast = useToast()
  const navigate = useNavigate()

  const suspendedMs = user.suspended_at ? new Date(user.suspended_at).getTime() : null
  const deleteReadyAt = suspendedMs === null ? null : new Date(suspendedMs + DELETE_WAIT_MS)
  // The page can stay open across the 10-minute wait, so a timer re-renders it at the deadline.
  const [now, setNow] = useState(() => Date.now())
  const readyMs = deleteReadyAt === null ? null : deleteReadyAt.getTime()
  useEffect(() => {
    if (readyMs === null || readyMs <= Date.now()) return undefined
    const timer = setTimeout(() => setNow(Date.now()), readyMs - Date.now() + 250)
    return () => clearTimeout(timer)
  }, [readyMs])
  const canDelete = readyMs !== null && readyMs <= now

  const close = () => {
    setDialog(null)
    setError(null)
    setReason('')
  }

  // Step 1 of delete: the dry run. Nothing is deleted. The dialog opens with the counts and the token.
  const startDelete = async () => {
    setNotice(null)
    setBusy(true)
    try {
      const dry = await adminApi.deleteDryRun(user.id)
      setDialog({ kind: 'delete', dry, expiresAt: new Date(Date.now() + dry.expires_in * 1000).toISOString() })
    } catch (err) {
      setNotice(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  // Every real call goes out only from the dialog's confirm button, with the typed login.
  const confirm = async (typed) => {
    setBusy(true)
    setError(null)
    try {
      if (dialog.kind === 'suspend') {
        await adminApi.suspend(user.id, typed, reason.trim())
        toast({ message: `Suspended ${typed}.` })
      } else if (dialog.kind === 'unsuspend') {
        await adminApi.unsuspend(user.id, typed)
        toast({ message: `Unsuspended ${typed}.` })
      } else {
        await adminApi.deleteUser(user.id, dialog.dry.confirm_token, typed)
        toast({ message: `Deleted ${typed} and their data.` })
        navigate('/admin/users')
        return
      }
      close()
      onChanged()
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
          <Section title="Actions" headingLevel={2}>
            <Stack gap={4}>
              {notice && <Banner tone="danger" role="alert">{notice}</Banner>}
              <Inline gap={3}>
                <Button variant="secondary" onClick={() => { setNotice(null); setViewing(true) }}>View as</Button>
                {user.suspended_at ? (
                  <Button variant="secondary" onClick={() => { setNotice(null); setDialog({ kind: 'unsuspend' }) }}>Unsuspend</Button>
                ) : (
                  <Button variant="danger" onClick={() => { setNotice(null); setDialog({ kind: 'suspend' }) }}>Suspend</Button>
                )}
                {user.suspended_at && (
                  <Button variant="danger" onClick={startDelete} loading={busy && dialog === null} disabledReason={canDelete ? undefined : `Delete opens ${when(deleteReadyAt.toISOString())}, 10 minutes after the suspension.`}>
                    Delete user
                  </Button>
                )}
              </Inline>
            </Stack>
          </Section>
        {viewing && <ViewAsDialog user={user} onClose={() => setViewing(false)} />}
        {dialog?.kind === 'suspend' && (
          <ConfirmLoginDialog
            title={`Suspend ${user.login}?`}
            description={`User id ${user.id}. They cannot sign in, and their API tokens, connected apps, MCP calls and share links stop working at once. Nothing is deleted, and you can unsuspend them.`}
            user={user}
            confirmLabel="Suspend"
            busy={busy}
            error={error}
            onConfirm={confirm}
            onClose={close}
          >
            <Field label="Reason (optional)" help="Up to 200 characters. Kept in the audit log.">
              <Input value={reason} onChange={setReason} maxLength={200} />
            </Field>
          </ConfirmLoginDialog>
        )}
        {dialog?.kind === 'unsuspend' && (
          <ConfirmLoginDialog
            title={`Unsuspend ${user.login}?`}
            description={`User id ${user.id}. They can sign in again. Their tokens and connected apps work again, and their share links answer again.`}
            user={user}
            confirmLabel="Unsuspend"
            tone="primary"
            busy={busy}
            error={error}
            onConfirm={confirm}
            onClose={close}
          />
        )}
        {dialog?.kind === 'delete' && (
          <ConfirmLoginDialog
            title={`Delete ${user.login} for good?`}
            description={`User id ${user.id}. This deletes the user, every item below and their image files. It cannot be undone. This confirmation expires at ${when(dialog.expiresAt)}.`}
            user={user}
            confirmLabel="Delete for good"
            busy={busy}
            error={error}
            onConfirm={confirm}
            onClose={close}
          >
            <DescriptionList
              columns={2}
              items={[
                ...COUNT_TERMS.map(([key, term]) => ({ term, value: show(dialog.dry.will_delete[key]) })),
                { term: 'Image files', value: dialog.dry.will_delete.image_files_truncated ? `${show(dialog.dry.will_delete.image_files)} (list cut short)` : show(dialog.dry.will_delete.image_files) }
              ]}
            />
          </ConfirmLoginDialog>
        )}
    </>
  )
}

// Start viewing as this user (#291). The reason is required (3 to 200 characters) and goes to the audit log. On success the
// browser loads the home page afresh, so the app starts with the user's view and nothing of the admin's page stays in state.
function ViewAsDialog({ user, onClose }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const valid = Array.from(reason.trim()).length >= 3

  const start = async () => {
    setBusy(true)
    setError(null)
    try {
      await adminApi.startViewAs(user.id, reason.trim())
      window.location.assign('/')
    } catch (err) {
      setError(messageOf(err))
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onClose={busy ? undefined : onClose}
      dismissible={!busy}
      title={`View as ${user.login}?`}
      description="You see the app as this user for 30 minutes, read-only. Their drafts stay private. Starting and ending are written to the audit log."
      actions={[
        { label: 'Cancel', variant: 'secondary', onClick: onClose, autoFocus: true, disabled: busy },
        { label: 'View as', variant: 'primary', onClick: start, disabledReason: valid ? undefined : 'Write a reason (at least 3 characters)', loading: busy }
      ]}
    >
      <Stack gap={4}>
        <Field label="Reason" help="3 to 200 characters. Kept in the audit log.">
          <Input value={reason} onChange={setReason} maxLength={200} />
        </Field>
        {error && <Banner tone="danger" role="alert">{error}</Banner>}
      </Stack>
    </Dialog>
  )
}
