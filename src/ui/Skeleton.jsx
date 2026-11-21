import './Skeleton.css'

// A loading placeholder: shimmering bars, one "Loading…" text for screen readers. The shimmer stops under reduced motion (the tokens set its time to 0).
export default function Skeleton({ lines = 3, variant = 'text' }) {
  return (
    <div className={`ui-skeleton ui-skeleton--${variant}`} aria-busy="true">
      <span className="ui-skeleton__sr">Loading…</span>
      {Array.from({ length: lines }, (_, index) => (
        <span key={index} className="ui-skeleton__bar" aria-hidden="true" />
      ))}
    </div>
  )
}
