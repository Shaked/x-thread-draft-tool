import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { tokensApi } from '../utils/api'
import ThemeSetting from '../components/ThemeSetting'

const EXPIRY_OPTIONS = [30, 90, 365]

const formatDate = (value) => (value ? new Date(value).toLocaleDateString() : '—')

export default function TokensPage() {
  const [tokens, setTokens] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [name, setName] = useState('')
  const [days, setDays] = useState(90)
  const [created, setCreated] = useState(null)
  const [copied, setCopied] = useState(false)

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
    load()
  }, [])

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
      <h1>API tokens</h1>
      <ThemeSetting />
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
