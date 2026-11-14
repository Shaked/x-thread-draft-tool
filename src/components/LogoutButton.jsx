import { authApi } from '../utils/api'
import { clearCachedDrafts } from '../utils/draftCache'
import Icon from './Icon'

/** Signs out of this browser (the server ends the session), drops the drafts cached here, then reloads. */
export default function LogoutButton() {
  const signOut = async () => {
    try {
      await authApi.logout()
    } catch (err) {
      console.error('Logout error:', err)
    }
    await clearCachedDrafts()
    window.location.assign('/')
  }
  return (
    <button type="button" className="logout-btn icon-btn" onClick={signOut} title="Sign out" aria-label="Sign out">
      <Icon name="signout" />
    </button>
  )
}
