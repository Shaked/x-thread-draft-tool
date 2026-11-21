import './Badge.css'

// A short status word. The word is the signal, not the colour. `live` announces changes (the editor's save status).
export default function Badge({ tone = 'neutral', children, live = false }) {
  const badge = <span className={`ui-badge ui-badge--${tone}`}>{children}</span>
  return live ? <span role="status" aria-live="polite">{badge}</span> : badge
}
