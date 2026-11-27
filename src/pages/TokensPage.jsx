import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { tokensApi } from '../utils/api'
import Badge from '../ui/Badge'
import Banner from '../ui/Banner'
import Button from '../ui/Button'
import Card from '../ui/Card'
import { useConfirm } from '../ui/Dialog'
import CodeBlock from '../ui/CodeBlock'
import Field from '../ui/Field'
import Inline from '../ui/Inline'
import Input from '../ui/Input'
import { List, ListItem } from '../ui/List'
import Page from '../ui/Page'
import PageHeader from '../ui/PageHeader'
import Section from '../ui/Section'
import Select from '../ui/Select'
import Skeleton from '../ui/Skeleton'
import Stack from '../ui/Stack'
import { useViewAsReason } from '../utils/viewAs'

const EXPIRY_OPTIONS = [1, 3, 7]

const formatDate = (value) => (value ? new Date(value).toLocaleDateString() : '—')

// Revoked wins over expired; a token past its expires_at cannot be used, so it is not shown as Active.
const statusOf = (token) => {
  if (token.revoked_at) return { tone: 'neutral', label: 'Revoked' }
  if (token.expires_at && new Date(token.expires_at) <= new Date()) return { tone: 'neutral', label: 'Expired' }
  return { tone: 'success', label: 'Active' }
}

export default function TokensPage() {
  const ask = useConfirm()
  const reason = useViewAsReason()
  const [tokens, setTokens] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [name, setName] = useState('')
  const [days, setDays] = useState(7)
  const [created, setCreated] = useState(null)
  const [copyFailed, setCopyFailed] = useState(false)

  const load = async () => {
    try {
      setError(null)
      const data = await tokensApi.list()
      setTokens(data.tokens || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial token list load on mount, runs once
    load()
  }, [])

  const handleCreate = async (event) => {
    event.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await tokensApi.create({ name: name.trim(), expires_in_days: days })
      setCreated(result)
      setCopyFailed(false)
      setName('')
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const handleRevoke = async (id) => {
    const confirmed = await ask({
      title: 'Revoke this token?',
      body: 'Revoke this token? Agents using it will stop working.',
      confirmLabel: 'Revoke token',
      tone: 'danger'
    })
    if (!confirmed) return
    try {
      await tokensApi.revoke(id)
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <Page width="narrow">
      <PageHeader title="API tokens" back={{ to: '/', label: '← Back to drafts' }} />
      <Stack gap={8}>
        <p>
          AI apps you connect are listed on <Link to="/settings/apps">Connected apps</Link>.
        </p>

        <Section
          title="Your API tokens"
          description={
            <>
              Tokens let agents use the API as you. Each token has the same permissions as your account in the app. See{' '}
              <code>/llms.txt</code> for how agents use them.
            </>
          }
        >
          <form onSubmit={handleCreate}>
            <Inline align="end" gap={3}>
              <Field label="Token name">
                <Input
                  value={name}
                  maxLength={100}
                  placeholder="Token name, e.g. Claude agent"
                  onChange={setName}
                />
              </Field>
              <Field label="Expires after">
                <Select
                  value={String(days)}
                  options={EXPIRY_OPTIONS.map((option) => ({ value: String(option), label: `${option} days` }))}
                  onChange={(value) => setDays(Number(value))}
                />
              </Field>
              <Button type="submit" variant="primary" loading={busy} loadingLabel="Creating…" disabled={!name.trim()} disabledReason={reason}>
                Create token
              </Button>
            </Inline>
          </form>

          {created && (
            <Banner tone="warning" role="status" title="Copy this token now.">
              <Stack gap={3}>
                <p>It won&apos;t be shown again.</p>
                <CodeBlock
                  key={created.token}
                  code={created.token}
                  copyLabel="Copy"
                  onCopyFail={() => setCopyFailed(true)}
                />
                {copyFailed && <p>Select the token above and copy it.</p>}
              </Stack>
            </Banner>
          )}

          {error && <Banner tone="danger" role="alert">{error}</Banner>}

          {loading ? (
            <Skeleton variant="row" lines={2} />
          ) : tokens.length === 0 ? (
            <p>No tokens yet. Create one above to let an agent use the API as you.</p>
          ) : (
            <Card padding="none">
              <List>
                {tokens.map((token) => {
                  const revoked = !!token.revoked_at
                  const status = statusOf(token)
                  return (
                    <ListItem
                      key={token.id}
                      title={token.name}
                      badge={<Badge tone={status.tone}>{status.label}</Badge>}
                      meta={[
                        <code key="prefix">{token.prefix}…</code>,
                        `Created ${formatDate(token.created_at)} via ${token.created_via}`,
                        `last used ${formatDate(token.last_used_at)}`,
                        ...(revoked ? [] : [`expires ${formatDate(token.expires_at)}`])
                      ]}
                      actions={
                        !revoked && (
                          <Button variant="danger-quiet" size="sm" onClick={() => handleRevoke(token.id)} disabledReason={reason}>
                            Revoke
                          </Button>
                        )
                      }
                    />
                  )
                })}
              </List>
            </Card>
          )}
        </Section>
      </Stack>
    </Page>
  )
}
