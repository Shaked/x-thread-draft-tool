import { Component } from 'react'
import Banner from './Banner'
import Button from './Button'
import { reloadToNewest } from '../utils/reloadToNewest'

// A failed dynamic import, as Chrome, Firefox and Safari word it, or the failed stylesheet that Vite loads before it.
const LOAD_FAILED = /dynamically imported module|Importing a module script failed|Unable to preload CSS/i

// A page or component in its own file (React.lazy) that fails to load shows `fallback`, not an empty screen (#551).
// It happens after a deploy: the open tab asks for a file of the build before, the host answers index.html and the
// import fails. React keeps a failed import, so only a reload fetches the new version. No `fallback`: a Reload notice;
// Reload waits for the new service worker first, or the old precached app would load again (reloadToNewest).
// Any other error is thrown on, as without this boundary: a reload cannot fix a bug, so it must not ask for one.
export default class LoadBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  render() {
    const { error } = this.state
    if (error === null) return this.props.children
    if (!LOAD_FAILED.test(String(error?.message))) throw error
    return this.props.fallback === undefined ? <ReloadNotice /> : this.props.fallback
  }
}

export function ReloadNotice() {
  return (
    <Banner tone="warning" role="alert" actions={<Button onClick={() => reloadToNewest()}>Reload</Button>}>
      This part of the app could not load. A new version may be out: reload to get it.
    </Banner>
  )
}
