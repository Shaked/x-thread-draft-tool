import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Button from '../../ui/Button'
import EmptyState from '../../ui/EmptyState'
import Page from '../../ui/Page'
import PageHeader from '../../ui/PageHeader'
import SideLayout from '../../ui/SideLayout'
import SignInAgain from '../../components/admin/SignInAgain'
import AdminAuditPage from './AdminAuditPage'
import AdminMetricsPage from './AdminMetricsPage'
import AdminFlagsPage from './AdminFlagsPage'
import AdminStatsPage from './AdminStatsPage'
import AdminUserPage from './AdminUserPage'
import AdminUsersPage from './AdminUsersPage'
import ChangelogPage from '../ChangelogPage'

// The menu of the admin area (#482). `soon` entries have no page yet; each names the task that builds it. `page` entries are built.
const ENTRIES = [
  { path: '', label: 'Statistics' },
  { path: 'metrics', label: 'Metrics', page: <AdminMetricsPage /> },
  { path: 'flags', label: 'Feature flags', page: <AdminFlagsPage /> },
  { path: 'changelog', label: 'Changelog', page: <ChangelogPage /> },
  { path: 'users', label: 'Users', page: <AdminUsersPage /> },
  { path: 'audit', label: 'Audit log', page: <AdminAuditPage /> }
]

// The entry of the open page: its own path, or a page under it (a user's page is under Users). Statistics only on /admin.
const isCurrent = (pathname, to) => pathname === to || (to !== '/admin' && pathname.startsWith(`${to}/`))

// The admin shell: a menu (the side column from 768 px, two columns above the page on phones) and the open page.
export default function AdminLayout() {
  const pathname = useLocation().pathname.replace(/\/$/, '')
  return (
    <SignInAgain>
    <Page width="wide">
      <PageHeader title="Admin" back={{ to: '/', label: '← Back to drafts' }} />
      <SideLayout
        side={
          <nav aria-label="Admin pages">
            {ENTRIES.map((entry) => {
              const to = entry.path ? `/admin/${entry.path}` : '/admin'
              return (
                <Button key={to} variant="ghost" fullWidth to={to} ariaCurrent={isCurrent(pathname, to) ? 'page' : undefined}>
                  {entry.label}
                </Button>
              )
            })}
          </nav>
        }
      >
        <Routes>
          <Route index element={<AdminStatsPage />} />
          {ENTRIES.filter((entry) => entry.soon || entry.page).map((entry) => (
            <Route key={entry.path} path={entry.path} element={entry.page ?? <EmptyState title={entry.label} description="Coming soon." />} />
          ))}
          <Route path="users/:id" element={<AdminUserPage />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </SideLayout>
    </Page>
    </SignInAgain>
  )
}
