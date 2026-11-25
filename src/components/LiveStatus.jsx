import Button from '../ui/Button'
import './LiveStatus.css'

// The editor header's live-updates note (#363): "Updated just now" after a change from another app, or the paused note with Resume.
export default function LiveStatus({ updatedText, paused, onResume }) {
  return (
    <>
      {updatedText && <span className="live-status">{updatedText}</span>}
      {paused && (
        <>
          <span className="live-status">Live updates paused</span>
          <Button variant="ghost" onClick={onResume}>
            Resume
          </Button>
        </>
      )}
    </>
  )
}
