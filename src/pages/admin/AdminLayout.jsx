import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Button from '../../ui/Button'
import EmptyState from '../../ui/EmptyState'
import Page from '../../ui/Page'
import PageHeader from '../../ui/PageHeader'
import SideLayout from '../../ui/SideLayout'
import Stack from '../../ui/Stack'
import AdminStatsPage from './AdminStatsPage'
import ChangelogPage from '../ChangelogPage'

// The menu of the admin area (#482). `soon` entries have no page yet; each names the task that builds it. `page` entries are built.
const ENTRIES = [
  { path: '', label: 'Statistics' },
  { path: 'metrics', label: 'Metrics', soon: true },
  { path: 'flags', label: 'Feature flags', soon: true },
  { path: 'changelog', label: 'Changelog', page: <ChangelogPage /> },
  { path: 'users', label: 'Users', soon: true },
  { path: 'audit', label: 'Audit log', soon: true }
]

// The admin shell: a menu (the side column from 768 px, a list above the page on phones) and the open page.
export default function AdminLayout() {
  const { pathname } = useLocation()
  return (
    <Page width="wide">
      <PageHeader title="Admin" back={{ to: '/', label: '← Back to drafts' }} />
      <SideLayout
        side={
          <nav aria-label="Admin pages">
            <Stack gap={2}>
              {ENTRIES.map((entry) => {
                const to = entry.path ? `/admin/${entry.path}` : '/admin'
                return (
                  <Button key={to} variant="ghost" fullWidth to={to} ariaCurrent={pathname.replace(/\/$/, '') === to ? 'page' : undefined}>
                    {entry.label}
                  </Button>
                )
              })}
            </Stack>
          </nav>
        }
      >
        <Routes>
          <Route index element={<AdminStatsPage />} />
          {ENTRIES.filter((entry) => entry.soon || entry.page).map((entry) => (
            <Route key={entry.path} path={entry.path} element={entry.page ?? <EmptyState title={entry.label} description="Coming soon." />} />
          ))}
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
      </SideLayout>
    </Page>
  )
}
