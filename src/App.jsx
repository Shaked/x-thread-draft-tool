import { lazy, Suspense, useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { authApi } from './utils/api'
import { CurrentUserContext, isAdmin } from './utils/currentUser'
import LoginPage from './components/LoginPage'
import DraftList from './components/DraftList'
import DraftEditor from './pages/DraftEditor'
import XThreadPreviewPage from './pages/XThreadPreviewPage'
import TokensPage from './pages/TokensPage'
import AppsPage from './pages/AppsPage'
import AboutPage from './pages/AboutPage'
import FlagsPage from './pages/FlagsPage'
import { applyTheme, getTheme } from './utils/theme'
import { applySkin } from './utils/skin'
import { clearCachedDrafts } from './utils/draftCache'
import { ToastProvider } from './ui/Toast'
import { ConfirmProvider } from './ui/Dialog'

// The admin area is its own chunk that only an admin's browser asks for (#285). Keep this the only import of it.
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'))

function App() {
  const [user, setUser] = useState(null)
  // A suspended account: the server says so (me), or the sign-in callback sent the browser to /?suspended=1.
  const [suspended, setSuspended] = useState(() => new URLSearchParams(window.location.search).get('suspended') === '1')
  useEffect(() => {
    applyTheme(getTheme())
    applySkin()
  }, [])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    authApi
      .me()
      .then((res) => {
        setUser(res.user ?? null)
        if (res.suspended === true) setSuspended(true)
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
    <CurrentUserContext.Provider value={user}>
    <ToastProvider>
    <BrowserRouter>
    <ConfirmProvider>
      <div className="app">
        <Routes>
          <Route
            path="/"
            element={
              user ? (
                <DraftList user={user} />
              ) : (
                <LoginPage suspended={suspended} />
              )
            }
          />
          <Route
            path="/draft/:id"
            element={<DraftEditor user={user} />}
          />
          <Route
            path="/settings/tokens"
            element={user ? <TokensPage /> : <LoginPage suspended={suspended} />}
          />
          <Route
            path="/settings/apps"
            element={user ? <AppsPage /> : <LoginPage suspended={suspended} />}
          />
          <Route
            path="/settings/flags"
            element={user ? <FlagsPage /> : <LoginPage suspended={suspended} />}
          />
          <Route
            path="/about"
            element={user ? <AboutPage /> : <LoginPage suspended={suspended} />}
          />
          {/* Admin only (#484): the changelog moved under /admin. For anyone else this path is unknown, so the catch-all below answers it. */}
          {isAdmin(user) && <Route path="/changelog" element={<Navigate to="/admin/changelog" replace />} />}
          {/* Admin only (#482): for anyone else this path is unknown, so the catch-all below answers it. */}
          {isAdmin(user) && (
            <Route
              path="/admin/*"
              element={
                <Suspense fallback={<div className="loading">Loading...</div>}>
                  <AdminLayout />
                </Suspense>
              }
            />
          )}
          <Route
            path="/x-thread-preview/:token"
            element={<XThreadPreviewPage />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </ConfirmProvider>
    </BrowserRouter>
    </ToastProvider>
    </CurrentUserContext.Provider>
  )
}

export default App
