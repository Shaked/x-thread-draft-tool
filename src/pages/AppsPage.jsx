import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { grantsApi } from '../utils/api'
import { connectEntries, PASTE_IN, PASTE_PLACES } from '../utils/connectApps'
import Badge from '../ui/Badge'
import Banner from '../ui/Banner'
import Button from '../ui/Button'
import Card from '../ui/Card'
import { useConfirm } from '../ui/Dialog'
import Inline from '../ui/Inline'
import { useViewAsReason } from '../utils/viewAs'
import CodeBlock, { CopyButton } from '../ui/CodeBlock'
import { List, ListItem } from '../ui/List'
import Page from '../ui/Page'
import PageHeader from '../ui/PageHeader'
import Section from '../ui/Section'
import Skeleton from '../ui/Skeleton'
import Stack from '../ui/Stack'

const formatDate = (value) => (value ? new Date(value).toLocaleDateString() : '—')

// The MCP connector and the REST API are the two things an app can be connected to.
const resourceLabel = (resource) => (resource.endsWith('/api/mcp') ? 'Agent connector' : 'API')

export default function AppsPage() {
  const ask = useConfirm()
  const reason = useViewAsReason()
  const [grants, setGrants] = useState([])
  const [grantsLoading, setGrantsLoading] = useState(true)
  const [grantsError, setGrantsError] = useState(null)
  const [grantsStatus, setGrantsStatus] = useState('')

  const loadGrants = async () => {
    try {
      setGrantsError(null)
      const data = await grantsApi.list()
      setGrants(data.grants || [])
    } catch (err) {
      setGrantsError(err.message)
    } finally {
      setGrantsLoading(false)
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial connected-apps load on mount, runs once
    loadGrants()
  }, [])

  const handleRevokeGrant = async (grant) => {
    const confirmed = await ask({
      title: 'Revoke access?',
      body: `Revoke access for ${grant.client_name}? It stops working right away.`,
      confirmLabel: 'Revoke access',
      tone: 'danger'
    })
    if (!confirmed) return
    setGrantsError(null)
    setGrantsStatus('')
    try {
      await grantsApi.revoke(grant.id)
      setGrantsStatus(`Access for ${grant.client_name} was revoked.`)
      await loadGrants()
    } catch (err) {
      setGrantsError(err.message)
    }
  }

  return (
    <Page width="narrow">
      <PageHeader title="Connected apps" back={{ to: '/', label: '← Back to drafts' }} />
      <Stack gap={8}>
        <p>
          Tokens for agents that call the API are on <Link to="/settings/tokens">API tokens</Link>.
        </p>

        <Section title="Connect an AI app">
          <Card padding="none">
            <List>
              {connectEntries(`${window.location.origin}/api/mcp`).map((entry) => (
                <ListItem key={entry.id} title={entry.name} meta={[entry.hint]}>
                  <CodeBlock code={entry.copy} copyLabel={entry.copyLabel} />
                </ListItem>
              ))}
            </List>
          </Card>
          <p>You approve each app once with your GitHub sign-in. Remove it any time below.</p>
        </Section>

        <Section
          title="Use with AI apps"
          description="Some apps only show a thread as text. If yours does, paste one of these texts into the app's own instructions. Each one is a plain sentence, and it publishes nothing."
        >
          <Section title="English" headingLevel={3}>
            <Card>
              <blockquote lang="en" dir="auto">{PASTE_IN.en}</blockquote>
            </Card>
            <Inline>
              <CopyButton text={PASTE_IN.en} label="Copy English text" />
            </Inline>
          </Section>
          <Section title="Hebrew" headingLevel={3}>
            <Card>
              <blockquote lang="he" dir="auto">{PASTE_IN.he}</blockquote>
            </Card>
            <Inline>
              <CopyButton text={PASTE_IN.he} label="Copy Hebrew text" />
            </Inline>
          </Section>
          <Section title="Where to paste it" headingLevel={3}>
            <Card padding="none">
              <List>
                {PASTE_PLACES.map((place) => (
                  <ListItem key={place.name} title={`${place.name}:`} meta={[place.where]} />
                ))}
              </List>
            </Card>
          </Section>
        </Section>

        <Section
          title="Connected apps"
          description="Apps and agents you have signed in with. Revoking one signs it out right away. You can connect it again later."
        >
          {grantsError && <Banner tone="danger" role="alert">{grantsError}</Banner>}
          <p role="status" aria-live="polite">{grantsStatus}</p>
          {grantsLoading ? (
            <Skeleton variant="row" lines={2} />
          ) : grants.length === 0 ? (
            <p>No apps are connected. To connect one, use Connect an AI app above.</p>
          ) : (
            <Card padding="none">
              <List>
                {grants.map((grant) => {
                  const revoked = !!grant.revoked_at
                  return (
                    <ListItem
                      key={grant.id}
                      title={grant.client_name}
                      badge={<Badge tone={revoked ? 'neutral' : 'success'}>{revoked ? 'Revoked' : 'Active'}</Badge>}
                      meta={[
                        `Used for ${resourceLabel(grant.resource)}`,
                        'Access to your drafts',
                        `Connected ${formatDate(grant.created_at)}`,
                        `Last used ${grant.last_used_at ? formatDate(grant.last_used_at) : 'never'}`,
                        ...(revoked ? [`Revoked ${formatDate(grant.revoked_at)}`] : [])
                      ]}
                      actions={
                        !revoked && (
                          <Button
                            variant="danger-quiet"
                            size="sm"
                            ariaLabel={`Revoke access for ${grant.client_name}`}
                            onClick={() => handleRevokeGrant(grant)}
                            disabledReason={reason}
                          >
                            Revoke access
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
