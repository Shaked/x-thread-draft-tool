import { lazy, Suspense } from 'react'
import { getKit } from '../utils/skin'

// Rare UI's animated counter (feature flag "Components", src/utils/skin.js). Its chunk loads only when the flag is on.
const RareCounter = lazy(() => import('./rare/AnimatedCounter.jsx'))

// A "value/max" count, such as the characters of a post. Flag off (default): plain text. Flag on: the value's digits
// roll when they change, inside a left-to-right box so "120/280" keeps its order in Hebrew text. The text is read
// once; the counter is not a live region. Until the chunk loads, the plain number shows.
export default function Count({ value, max = null }) {
  const suffix = max === null ? '' : `/${max}`
  if (getKit() !== 'rare') return `${value}${suffix}`
  return (
    <span dir="ltr" className="inline-flex [unicode-bidi:isolate]">
      <Suspense fallback={value}>
        <RareCounter value={value} />
      </Suspense>
      {suffix}
    </span>
  )
}
