import { delMany, keys } from 'idb-keyval'
import { authApi } from '../utils/api'
import Icon from './Icon'

/** Signs out of this browser (the server ends the session), drops the drafts cached here, then reloads. */
export default function LogoutButton() {
  const signOut = async () => {
    try {
      await authApi.logout()
    } catch (err) {
      console.error('Logout error:', err)
    }
    try {
      const cached = (await keys()).filter((key) => typeof key === 'string' && key.startsWith('draft-'))
      await delMany(cached)
    } catch (err) {
      // A blocked IndexedDB must never block sign-out.
      console.error('Clearing cached drafts failed:', err)
    }
    window.location.assign('/')
  }
  return (
    <button type="button" className="logout-btn icon-btn" onClick={signOut} title="Sign out" aria-label="Sign out">
      <Icon name="signout" />
    </button>
  )
}
