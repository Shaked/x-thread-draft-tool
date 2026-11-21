import { authApi } from '../utils/api'
import { clearCachedDrafts } from '../utils/draftCache'
import IconButton from '../ui/IconButton'

/** Signs out of this browser (the server ends the session), drops the drafts cached here, then reloads. */
export async function signOut() {
  try {
    await authApi.logout()
  } catch (err) {
    console.error('Logout error:', err)
  }
  await clearCachedDrafts()
  window.location.assign('/')
}

export default function LogoutButton() {
  return <IconButton icon="signout" label="Sign out" onClick={signOut} />
}
