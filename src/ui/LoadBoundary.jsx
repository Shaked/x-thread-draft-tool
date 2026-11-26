import { Component } from 'react'
import Banner from './Banner'
import Button from './Button'

// A page or component in its own file (React.lazy) that fails to load shows `fallback`, not an empty screen (#551).
// It happens after a deploy: the open tab asks for a file of the build before, the host answers index.html and the
// import fails. React keeps a failed import, so only a reload fetches the new version. No `fallback`: a Reload notice.
export default class LoadBoundary extends Component {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return this.props.fallback === undefined ? <ReloadNotice /> : this.props.fallback
  }
}

export function ReloadNotice() {
  return (
    <Banner tone="warning" role="alert" actions={<Button onClick={() => window.location.reload()}>Reload</Button>}>
      This part of the app could not load. A new version may be out: reload to get it.
    </Banner>
  )
}
