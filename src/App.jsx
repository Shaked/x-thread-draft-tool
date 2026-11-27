import { lazy, Suspense, useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { adminApi, authApi } from './utils/api'
import { CurrentUserContext, isAdmin } from './utils/currentUser'
import ViewAsBar from './components/ViewAsBar'
import { ViewAsContext } from './utils/viewAs'
import LoginPage from './components/LoginPage'
import DraftList from './components/DraftList'
import DraftEditor from './pages/DraftEditor'
import UploadPage from './pages/UploadPage'
import XThreadPreviewPage from './pages/XThreadPreviewPage'
import TokensPage from './pages/TokensPage'
import AppsPage from './pages/AppsPage'
import AboutPage from './pages/AboutPage'
import { applyTheme, getTheme } from './utils/theme'
import { allowFlags, forgetFlags, setKit, setSkin } from './utils/skin'
import { clearCachedDrafts } from './utils/draftCache'
import { ToastProvider } from './ui/Toast'
import { ConfirmProvider } from './ui/Dialog'
import LoadBoundary, { ReloadNotice } from './ui/LoadBoundary'
import Page from './ui/Page'
import Skeleton from './ui/Skeleton'
import PageHeader from './ui/PageHeader'

// The admin area is its own chunk that only an admin's browser asks for (#285). Keep this the only import of it.
const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'))

function App() {
  const [user, setUser] = useState(null)
  // A suspended account: the server says so (me), or the sign-in callback sent the browser to /?suspended=1.
  const [suspended, setSuspended] = useState(() => new URLSearchParams(window.location.search).get('suspended') === '1')
  useEffect(() => {
    applyTheme(getTheme())
  }, [])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    authApi
      .me()
      .then(async (res) => {
        // The look flags are the admin's (#483): everyone else gets the default look. The admin's account choice is copied
        // to this device before the first render, so the Rare components do not flash in.
        allowFlags(isAdmin(res.user))
        if (!isAdmin(res.user)) forgetFlags()
        if (isAdmin(res.user)) {
          const flags = await adminApi.flags().catch(() => null)
          const valueOf = (name) => flags?.find((flag) => flag.name === name)?.value
          if (valueOf('look')) setSkin(valueOf('look'))
          if (valueOf('components')) setKit(valueOf('components'))
        }
        setUser(res.user ?? null)
        if (res.suspended === true) setSuspended(true)
        // Nobody is signed in (a session that ended elsewhere, such as the consent page's sign-out): no
        // draft text may stay cached in this browser. Only an explicit answer clears it, never an offline error.
        if (!res.user) clearCachedDrafts()
      })
      .catch((err) => {
        console.error('Failed to load session:', err)
        allowFlags(false)
        setUser(null)
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="app">
        <Page width="narrow">
          <Skeleton lines={3} />
        </Page>
      </div>
    )
  }

  return (
    <CurrentUserContext.Provider value={user}>
    <ViewAsContext.Provider value={user?.view_as ?? null}>
    <ToastProvider>
    <BrowserRouter>
    <ConfirmProvider>
      <ViewAsBar />
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
                // A deploy since this tab loaded removes the old admin file: a notice with Reload, not an empty page (#551).
                <LoadBoundary fallback={<Page><PageHeader title="This page could not load" back={{ to: '/', label: '← Back to drafts' }} /><ReloadNotice /></Page>}>
                  <Suspense fallback={<div className="loading">Loading...</div>}>
                    <AdminLayout />
                  </Suspense>
                </LoadBoundary>
              }
            />
          )}
          {/* A one-time upload link (#418): no sign-in; the token is in the fragment. */}
          <Route path="/upload" element={<UploadPage />} />
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
    </ViewAsContext.Provider>
    </CurrentUserContext.Provider>
  )
}

export default App
