import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation } from 'react-router-dom'
import { useDismiss } from '../utils/useDismiss'
import Icon from './Icon'
import { signOut } from './LogoutButton'
import ThemeSetting from './ThemeSetting'

/** The menu button of a signed-in page header and the left drawer it opens (closed by default). */
export default function AppMenu() {
  // The menu is open only on the page it was opened on, so a route change closes it.
  const { pathname } = useLocation()
  const [openAt, setOpenAt] = useState(null)
  // A route change clears the state, so going back to the old path does not reopen the menu.
  if (openAt !== null && openAt !== pathname) setOpenAt(null)
  const open = openAt === pathname
  const setOpen = useCallback((next) => setOpenAt(next ? pathname : null), [pathname])
  const button = useRef(null)
  const layer = useRef(null)

  const close = () => setOpen(false)

  useDismiss(open, layer, setOpen)

  // While open: the page behind is inert (set through the DOM, React 18.2 has no `inert` prop) and does not scroll.
  useEffect(() => {
    if (!open) return undefined
    const root = document.getElementById('root')
    const trigger = button.current
    root?.setAttribute('inert', '')
    document.documentElement.classList.add('menu-open')
    const panel = layer.current
    panel?.querySelector('a')?.focus()
    // Keep Tab inside the drawer: wrap from the last item to the first and back.
    const trap = (event) => {
      if (event.key !== 'Tab' || !panel) return
      const items = [...panel.querySelectorAll('a[href], button, input')]
      const at = items.indexOf(document.activeElement)
      const next = event.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : at < 0 || at === items.length - 1 ? 0 : at + 1
      event.preventDefault()
      items[next]?.focus()
    }
    document.addEventListener('keydown', trap)
    return () => {
      document.removeEventListener('keydown', trap)
      root?.removeAttribute('inert')
      document.documentElement.classList.remove('menu-open')
      trigger?.focus()
    }
  }, [open])

  return (
    <>
      <button
        type="button"
        ref={button}
        className="menu-btn"
        aria-label="Menu"
        title="Menu"
        aria-expanded={open}
        aria-controls="app-menu"
        onClick={() => setOpen(true)}
      >
        <Icon name="menu" />
      </button>
      {open &&
        createPortal(
          <div ref={layer}>
            <div className="app-menu-scrim" onClick={close} />
            <nav id="app-menu" className="app-menu" role="dialog" aria-modal="true" aria-labelledby="app-menu-title">
              <div className="app-menu-head">
                <h2 id="app-menu-title">X Thread Draft Tool</h2>
                <button type="button" className="menu-btn" aria-label="Close menu" title="Close menu" onClick={close}>
                  <Icon name="close" />
                </button>
              </div>
              <ul className="app-menu-list">
                <li>
                  <Link to="/" className="app-menu-item" onClick={close}>
                    Drafts
                  </Link>
                </li>
                <li className="app-menu-label">Settings</li>
                <li className="app-menu-section">
                  <ThemeSetting />
                </li>
                <li>
                  <Link to="/settings/tokens" className="app-menu-item" onClick={close}>
                    API tokens and apps
                  </Link>
                </li>
              </ul>
              <button type="button" className="app-menu-item app-menu-signout" onClick={signOut}>
                Sign out
              </button>
            </nav>
          </div>,
          document.body
        )}
    </>
  )
}
