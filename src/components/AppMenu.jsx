import { useCallback, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { formatVersion, localBuildInfo, utcText } from '../utils/version'
import Badge from '../ui/Badge'
import Button from '../ui/Button'
import Dialog from '../ui/Dialog'
import IconButton from '../ui/IconButton'
import Section from '../ui/Section'
import Stack from '../ui/Stack'
import { isAdmin as isAdminUser, useCurrentUser } from '../utils/currentUser'
import { signOut } from './LogoutButton'
import ThemeSetting from './ThemeSetting'
import './AppMenu.css'

/** The menu button of a signed-in page header and the drawer it opens on the inline start edge (closed by default). */
export default function AppMenu() {
  // The menu is open only on the page it was opened on, so a route change closes it.
  const { pathname } = useLocation()
  const [openAt, setOpenAt] = useState(null)
  // A route change clears the state, so going back to the old path does not reopen the menu.
  if (openAt !== null && openAt !== pathname) setOpenAt(null)
  const open = openAt === pathname
  const setOpen = useCallback((next) => setOpenAt(next ? pathname : null), [pathname])

  const close = () => setOpen(false)
  const menuButton = useRef(null)
  const user = useCurrentUser()
  const isAdmin = isAdminUser(user)
  const build = localBuildInfo()
  const version = formatVersion(build, new Date())

  // Focus, Escape, the scrim, the inert page and focus return come from Dialog.
  return (
    <>
      <IconButton ref={menuButton} icon="menu" label="Menu" expanded={open} controls="app-menu" onClick={() => setOpen(true)} />
      {/* Shown only to the admin (#282): `role` comes from /api/auth/me for a browser session. */}
      {isAdmin && (
        <span role="status" aria-label="You are the admin">
          <Badge tone="accent">Admin</Badge>
        </span>
      )}
      <Dialog id="app-menu" open={open} onClose={close} placement="sheet-start" title="X Thread Draft Tool" returnTo={menuButton}>
        <div className="app-menu-close">
          <IconButton icon="close" label="Close menu" onClick={close} />
        </div>
        <div className="app-menu">
          <div data-autofocus>
            <Button variant="ghost" fullWidth to="/" onClick={close}>
              Drafts
            </Button>
          </div>
          <Section title="Settings" headingLevel={3}>
            <ThemeSetting />
            <Stack gap={2}>
              <Button variant="ghost" fullWidth to="/settings/tokens" onClick={close}>
                API tokens
              </Button>
              <Button variant="ghost" fullWidth to="/settings/apps" onClick={close}>
                Connected apps
              </Button>
              <Button variant="ghost" fullWidth to="/settings/flags" onClick={close}>
                Feature flags
              </Button>
              {user?.admin === true && (
                <Button variant="ghost" fullWidth to="/changelog" onClick={close}>
                  Changelog
                </Button>
              )}
            </Stack>
          </Section>
          {/* Shown only to the admin (#482). The pages are a lazy chunk (#285). */}
          {isAdmin && (
            <Section title="Admin" headingLevel={3}>
              <Button variant="ghost" fullWidth to="/admin" onClick={close}>
                Admin area
              </Button>
            </Section>
          )}
          <div className="app-menu-foot">
            <Button variant="ghost" fullWidth onClick={signOut}>
              Sign out
            </Button>
            <Button variant="ghost" size="sm" fullWidth to="/about" onClick={close} title={utcText(build?.deployed_at)}>
              Version {version.short} · deployed {version.ago}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  )
}
