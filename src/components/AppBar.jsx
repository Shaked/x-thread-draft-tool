import { useEffect, useState } from 'react'
import { isBarHidden, setBarHidden } from '../utils/barPref'
import Icon from './Icon'
import LogoutButton from './LogoutButton'

/** The actions of a signed-in page plus sign-out. In the page header on wide screens; a fixed bottom bar that can be hidden on phones. */
export default function AppBar({ children }) {
  const [hidden, setHidden] = useState(isBarHidden)

  // The page padding follows this attribute (see --bar-space in App.css).
  useEffect(() => {
    document.documentElement.dataset.bar = hidden ? 'hidden' : 'shown'
    return () => {
      delete document.documentElement.dataset.bar
    }
  }, [hidden])

  const label = hidden ? 'Show toolbar' : 'Hide toolbar'
  return (
    <div className={`app-bar${hidden ? ' is-hidden' : ''}`}>
      <div className="app-bar-actions" id="app-bar-actions">
        {children}
        <LogoutButton />
      </div>
      <button
        type="button"
        className="app-bar-toggle"
        onClick={() => setHidden(setBarHidden(!hidden))}
        aria-expanded={!hidden}
        aria-controls="app-bar-actions"
        aria-label={label}
        title={label}
      >
        <Icon name="chevron" />
      </button>
    </div>
  )
}
