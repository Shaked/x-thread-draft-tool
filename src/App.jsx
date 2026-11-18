import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { authApi } from './utils/api'
import LoginPage from './components/LoginPage'
import DraftList from './components/DraftList'
import DraftEditor from './pages/DraftEditor'
import XThreadPreviewPage from './pages/XThreadPreviewPage'
import TokensPage from './pages/TokensPage'
import AboutPage from './pages/AboutPage'
import ChangelogPage from './pages/ChangelogPage'
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
            element={user ? <TokensPage /> : <LoginPage />}
          />
          <Route
            path="/about"
            element={user ? <AboutPage /> : <LoginPage />}
          />
          <Route
            path="/changelog"
            element={user ? <ChangelogPage /> : <LoginPage />}
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
