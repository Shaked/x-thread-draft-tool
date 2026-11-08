import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { grantsApi, tokensApi } from '../utils/api'

const EXPIRY_OPTIONS = [1, 3, 7]

const formatDate = (value) => (value ? new Date(value).toLocaleDateString() : '—')

// The MCP connector and the REST API are the two things an app can be connected to.
const resourceLabel = (resource) => (resource.endsWith('/api/mcp') ? 'Agent connector' : 'API')

export default function TokensPage() {
  const [tokens, setTokens] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [name, setName] = useState('')
  const [days, setDays] = useState(7)
  const [created, setCreated] = useState(null)
  const [copied, setCopied] = useState(false)
  const [grants, setGrants] = useState([])
  const [grantsLoading, setGrantsLoading] = useState(true)
  const [grantsError, setGrantsError] = useState(null)
  const [grantsStatus, setGrantsStatus] = useState('')

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
    load()
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

  const handleCreate = async (event) => {
    event.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    setError(null)
    setCopied(false)
    try {
      const result = await tokensApi.create({ name: name.trim(), expires_in_days: days })
      setCreated(result)
      setName('')
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(created.token)
      setCopied(true)
    } catch {
      setError('Copy failed. Select the token and copy it manually.')
    }
  }

  const handleRevoke = async (id) => {
    if (!confirm('Revoke this token? Agents using it will stop working.')) return
    try {
      await tokensApi.revoke(id)
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="tokens-page">
      <p><Link to="/">← Back to drafts</Link></p>

      <section className="connected-apps" aria-labelledby="connected-apps-heading">
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
          <p>
            No apps are connected. To connect an agent, add this address as its connector:{' '}
            <code>{`${window.location.origin}/api/mcp`}</code>
          </p>
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

      <h1>API tokens</h1>
      <p>
        Tokens let agents use the API as you. Each token has the same permissions as your account in
        the app. See <code>/llms.txt</code> for how agents use them.
      </p>

      <form className="tokens-form" onSubmit={handleCreate}>
        <input
          type="text"
          placeholder="Token name, e.g. Claude agent"
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
          aria-label="Token name"
        />
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Expires after">
          {EXPIRY_OPTIONS.map((option) => (
            <option key={option} value={option}>{option} days</option>
          ))}
        </select>
        <button type="submit" className="new-draft-btn" disabled={busy || !name.trim()}>
          {busy ? 'Creating…' : 'Create token'}
        </button>
      </form>

      {created && (
        <div className="token-created" role="status">
          <p className="token-warning">
            <strong>Copy this token now.</strong> It won't be shown again.
          </p>
          <code className="token-secret">{created.token}</code>
          <p>
            <button type="button" onClick={handleCopy}>{copied ? 'Copied!' : 'Copy'}</button>
          </p>
        </div>
      )}

      {error && <div className="error" role="alert">{error}</div>}

      <h2>Your tokens</h2>
      {loading ? (
        <div className="loading">Loading…</div>
      ) : tokens.length === 0 ? (
        <p>No tokens yet.</p>
      ) : (
        <ul className="token-list">
          {tokens.map((token) => {
            const revoked = !!token.revoked_at
            return (
              <li key={token.id} className="token-row">
                <div>
                  <strong>{token.name}</strong> <code>{token.prefix}…</code>
                  <div>
                    Created {formatDate(token.created_at)} via {token.created_via} ·
                    last used {formatDate(token.last_used_at)} ·
                    {revoked ? ' revoked' : ` expires ${formatDate(token.expires_at)}`}
                  </div>
                </div>
                {!revoked && (
                  <button type="button" className="delete-btn" onClick={() => handleRevoke(token.id)}>
                    Revoke
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
