import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { tokensApi } from '../utils/api'
import AppBar from '../components/AppBar'
import AppMenu from '../components/AppMenu'
import CopyButton from '../components/CopyButton'

const EXPIRY_OPTIONS = [1, 3, 7]

const formatDate = (value) => (value ? new Date(value).toLocaleDateString() : '—')

export default function TokensPage() {
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
      <div className="settings-top">
        <span className="page-title">
          <AppMenu />
          <Link to="/">← Back to drafts</Link>
        </span>
        <AppBar />
      </div>

      <h1>API tokens</h1>

      <p>
        AI apps you connect are listed on <Link to="/settings/apps">Connected apps</Link>.
      </p>

      <section className="settings-card" aria-labelledby="tokens-heading">
        <h2 id="tokens-heading">Your API tokens</h2>
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
              <strong>Copy this token now.</strong> It won&apos;t be shown again.
            </p>
            <code className="token-secret">{created.token}</code>
            <CopyButton key={created.token} text={created.token} onFail={() => setCopyFailed(true)} />
            {copyFailed && <p className="token-warning">Select the token above and copy it.</p>}
          </div>
        )}

        {error && <div className="error" role="alert">{error}</div>}

        {loading ? (
          <div className="loading">Loading…</div>
        ) : tokens.length === 0 ? (
          <p className="token-empty">No tokens yet. Create one above to let an agent use the API as you.</p>
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
      </section>
    </div>
  )
}
