import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './utils/supabase'
import LoginPage from './components/LoginPage'
import DraftList from './components/DraftList'
import DraftEditor from './pages/DraftEditor'
import XThreadPreviewPage from './pages/XThreadPreviewPage'
import './styles/App.css'

function App() {
  const [session, setSession] = useState(null)
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      setLoading(false)
    })

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
    })

    return () => subscription.unsubscribe()
  }, [])

  const deployedAtRaw = import.meta.env.VITE_DEPLOYED_AT
  const deployCommitRaw = import.meta.env.VITE_DEPLOY_COMMIT_SHA
  const deployCommit = deployCommitRaw ? deployCommitRaw.slice(0, 12) : 'unknown'
  const deployedAt = deployedAtRaw
    ? new Date(deployedAtRaw).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'medium',
        timeZoneName: 'short'
      })
    : 'unknown'

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
        <div className="deployment-meta">
          <span><strong>Last deployed:</strong> {deployedAt}</span>
          <span><strong>Version:</strong> {deployCommit}</span>
        </div>
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
