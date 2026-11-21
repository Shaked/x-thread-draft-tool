import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { grantsApi } from '../utils/api'
import { connectEntries, PASTE_IN, PASTE_PLACES } from '../utils/connectApps'
import AppBar from '../components/AppBar'
import AppMenu from '../components/AppMenu'
import CopyButton from '../components/CopyButton'

const formatDate = (value) => (value ? new Date(value).toLocaleDateString() : '—')

// The MCP connector and the REST API are the two things an app can be connected to.
const resourceLabel = (resource) => (resource.endsWith('/api/mcp') ? 'Agent connector' : 'API')

export default function AppsPage() {
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
    if (!confirm(`Revoke access for ${grant.client_name}? It stops working right away.`)) return
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
    <div className="tokens-page">
      <div className="settings-top">
        <span className="page-title">
          <AppMenu />
          <Link to="/">← Back to drafts</Link>
        </span>
        <AppBar />
      </div>

      <h1>Connected apps</h1>
      <p>
        Tokens for agents that call the API are on <Link to="/settings/tokens">API tokens</Link>.
      </p>

      <section className="settings-card" aria-labelledby="connect-apps-heading">
        <h2 id="connect-apps-heading">Connect an AI app</h2>
        <ul className="grant-list connect-app-list">
          {connectEntries(`${window.location.origin}/api/mcp`).map((entry) => (
            <li key={entry.id} className="grant-row connect-app-row">
              <div>
                <strong>{entry.name}</strong>
                <div>{entry.hint}</div>
                <code>{entry.copy}</code>
              </div>
              <CopyButton text={entry.copy} label={entry.copyLabel} />
            </li>
          ))}
        </ul>
        <p>You approve each app once with your GitHub sign-in. Remove it any time below.</p>
      </section>

      <section className="settings-card ai-apps-card" aria-labelledby="ai-apps-heading">
        <h2 id="ai-apps-heading">Use with AI apps</h2>
        <p>
          Some apps only show a thread as text. If yours does, paste one of these texts into the app&apos;s own
          instructions. Each one is a plain sentence, and it publishes nothing.
        </p>
        <h3>English</h3>
        <blockquote lang="en" dir="auto">{PASTE_IN.en}</blockquote>
        <CopyButton text={PASTE_IN.en} label="Copy English text" />
        <h3>Hebrew</h3>
        <blockquote lang="he" dir="auto">{PASTE_IN.he}</blockquote>
        <CopyButton text={PASTE_IN.he} label="Copy Hebrew text" />
        <h3>Where to paste it</h3>
        <ul className="paste-places">
          {PASTE_PLACES.map((place) => (
            <li key={place.name}>
              <strong>{place.name}:</strong> {place.where}
            </li>
          ))}
        </ul>
      </section>

      <section className="settings-card" aria-labelledby="connected-apps-heading">
        <h2 id="connected-apps-heading">Connected apps</h2>
        <p>
          Apps and agents you have signed in with. Revoking one signs it out right away. You can
          connect it again later.
        </p>
        {grantsError && <div className="error" role="alert">{grantsError}</div>}
        <p className="connected-apps-status" role="status" aria-live="polite">{grantsStatus}</p>
        {grantsLoading ? (
          <div className="loading">Loading…</div>
        ) : grants.length === 0 ? (
          <p className="token-empty">No apps are connected. To connect one, use Connect an AI app above.</p>
        ) : (
          <ul className="grant-list">
            {grants.map((grant) => {
              const revoked = !!grant.revoked_at
              return (
                <li key={grant.id} className="grant-row">
                  <div>
                    <strong>{grant.client_name}</strong>
                    <div>
                      Used for {resourceLabel(grant.resource)} · Access to your drafts · Connected{' '}
                      {formatDate(grant.created_at)} · Last used{' '}
                      {grant.last_used_at ? formatDate(grant.last_used_at) : 'never'}
                    </div>
                    {revoked && <div>Revoked {formatDate(grant.revoked_at)}</div>}
                  </div>
                  {!revoked && (
                    <button
                      type="button"
                      className="grant-revoke-btn"
                      aria-label={`Revoke access for ${grant.client_name}`}
                      onClick={() => handleRevokeGrant(grant)}
                    >
                      Revoke access
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
