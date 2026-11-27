import './PreviewFrame.css'

// The shared thread, shown full screen. The share HTML is user content: a sandbox without allow-same-origin and
// allow-scripts keeps it away from this origin's cookie and fetch. The sandbox value is fixed here; do not widen it.
export default function PreviewFrame({ html }) {
  return (
    <iframe
      title="Thread preview"
      sandbox="allow-popups allow-popups-to-escape-sandbox"
      srcDoc={html}
      className="preview-frame"
    />
  )
}
