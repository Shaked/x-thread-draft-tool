import { authApi } from '../utils/api'
import Icon from './Icon'

/** Signs out of this browser, then reloads so the app reads the cleared session. */
export default function LogoutButton() {
  const signOut = async () => {
    try {
      await authApi.logout()
    } catch (err) {
      console.error('Logout error:', err)
    }
    window.location.assign('/')
  }
  return (
    <button type="button" className="logout-btn icon-btn" onClick={signOut} title="Sign out" aria-label="Sign out">
      <Icon name="signout" />
    </button>
  )
}
