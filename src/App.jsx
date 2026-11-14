import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { authApi } from './utils/api'
import LoginPage from './components/LoginPage'
import DraftList from './components/DraftList'
import DraftEditor from './pages/DraftEditor'
import XThreadPreviewPage from './pages/XThreadPreviewPage'
import TokensPage from './pages/TokensPage'
import './styles/App.css'
import { applyTheme, getTheme } from './utils/theme'
import { clearCachedDrafts } from './utils/draftCache'

function App() {
  const [user, setUser] = useState(null)
  useEffect(() => {
    applyTheme(getTheme())
  }, [])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    authApi
      .me()
      .then((res) => {
        setUser(res.user ?? null)
        // Nobody is signed in (a session that ended elsewhere, such as the consent page's sign-out): no
        // draft text may stay cached in this browser. Only an explicit answer clears it, never an offline error.
        if (!res.user) clearCachedDrafts()
      })
      .catch((err) => {
        console.error('Failed to load session:', err)
        setUser(null)
      })
      .finally(() => setLoading(false))
  }, [])

  const deployedAtRaw = import.meta.env.VITE_DEPLOYED_AT
  const deployCommitRaw = import.meta.env.VITE_DEPLOY_COMMIT_SHA
  const deployCommit = deployCommitRaw ? deployCommitRaw.slice(0, 12) : 'unknown'
  const { deployedAt, deployedAgo } = (() => {
    if (!deployedAtRaw) return { deployedAt: 'unknown', deployedAgo: '' }

    const deployedDate = new Date(deployedAtRaw)

    if (Number.isNaN(deployedDate.getTime())) return { deployedAt: 'unknown', deployedAgo: '' }

    const deployedAtFormatted = deployedDate.toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'medium'
    })

    const now = new Date()
    const diffMs = now.getTime() - deployedDate.getTime()
    const diffSeconds = Math.floor(diffMs / 1000)

    const intervals = [
      { label: 'year', seconds: 60 * 60 * 24 * 365 },
      { label: 'month', seconds: 60 * 60 * 24 * 30 },
      { label: 'day', seconds: 60 * 60 * 24 },
      { label: 'hour', seconds: 60 * 60 },
      { label: 'minute', seconds: 60 },
      { label: 'second', seconds: 1 }
    ]

    for (const interval of intervals) {
      const value = Math.floor(diffSeconds / interval.seconds)
      if (value >= 1) {
        const suffix = value === 1 ? '' : 's'
        return {
          deployedAt: deployedAtFormatted,
          deployedAgo: ` (${value} ${interval.label}${suffix} ago)`
        }
      }
    }

    return {
      deployedAt: deployedAtFormatted,
      deployedAgo: ' (just now)'
    }
  })()

  if (loading) {
    return (
      <div className="app loading-screen">
        <div className="loading">Loading...</div>
      </div>
    )
  }

  return (
    <BrowserRouter>
      <div className="app">
        <Routes>
          <Route
            path="/"
            element={
              user ? (
                <DraftList user={user} />
              ) : (
                <LoginPage />
              )
            }
          />
          <Route
            path="/draft/:id"
            element={<DraftEditor user={user} />}
          />
          <Route
            path="/settings/tokens"
            element={user ? <TokensPage deployedAt={deployedAt} deployedAgo={deployedAgo} deployCommit={deployCommit} /> : <LoginPage />}
          />
          <Route
            path="/x-thread-preview/:token"
            element={<XThreadPreviewPage />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}

export default App
