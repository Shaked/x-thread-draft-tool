import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import AppBar from '../components/AppBar'
import AppMenu from '../components/AppMenu'
import CopyButton from '../components/CopyButton'
import { reloadToNewest } from '../utils/reloadToNewest'
import { formatVersion, localBuildInfo, utcText } from '../utils/version'

function VersionDetails({ info }) {
  const version = formatVersion(info, new Date())
  return (
    <div className="about-version">
      <dl className="about-details">
        <dt>Commit</dt>
        <dd>
          <code title={info?.commit ?? undefined}>{version.short}</code>
        </dd>
        <dt>Deployed</dt>
        <dd>
          {version.deployedAt}
          <span className="about-utc"> ({utcText(info?.deployed_at)})</span>
          <span className="about-ago"> · {version.ago}</span>
        </dd>
      </dl>
      <CopyButton text={`${info?.commit ?? 'unknown'} ${info?.deployed_at ?? 'unknown'}`} label="Copy commit and deploy time" />
    </div>
  )
}

// The build of this page (in the browser) and the server's answer (GET /api/version), side by side.
export default function AboutPage() {
  const build = localBuildInfo()
  const [server, setServer] = useState({ state: 'loading', info: null })

  useEffect(() => {
    let active = true
    fetch('/api/version', { credentials: 'same-origin' })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((info) => active && setServer({ state: 'ready', info }))
      .catch(() => active && setServer({ state: 'error', info: null }))
    return () => {
      active = false
    }
  }, [])

  const newer = server.state === 'ready' && !!build?.commit && !!server.info?.commit && build.commit !== server.info.commit

  return (
    <div className="tokens-page about-page">
      <div className="settings-top">
        <span className="page-title">
          <AppMenu />
          <Link to="/">← Back to drafts</Link>
        </span>
        <AppBar />
      </div>

      <h1>About</h1>

      <section className="connected-apps" aria-labelledby="about-app-heading">
        <h2 id="about-app-heading">This app</h2>
        <p>The version of the app that is open in this browser.</p>
        <VersionDetails info={build} />
      </section>

      <section className="connected-apps" aria-labelledby="about-server-heading">
        <h2 id="about-server-heading">Server</h2>
        <p>The version the server runs now.</p>
        {server.state === 'loading' && <div className="loading">Loading…</div>}
        {server.state === 'error' && (
          <div className="error" role="alert">
            Could not reach the server
          </div>
        )}
        {server.state === 'ready' && <VersionDetails info={server.info} />}
        {newer && (
          <div className="about-newer" role="status">
            <p>A newer version is live. Reload to update.</p>
            <button type="button" className="copy-btn" onClick={() => reloadToNewest()}>
              Reload
            </button>
          </div>
        )}
      </section>

      <p className="about-changes">
        <Link to="/changelog">See what changed</Link>
      </p>
    </div>
  )
}
