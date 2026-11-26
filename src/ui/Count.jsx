import { lazy, Suspense } from 'react'
import { getKit } from '../utils/skin'
import LoadBoundary from './LoadBoundary'

// Rare UI's animated counter (feature flag "Components", src/utils/skin.js). Its chunk loads only when the flag is on.
const RareCounter = lazy(() => import('./rare/AnimatedCounter.jsx'))

// A "value/max" count, such as the characters of a post. Rare UI (the default): the value's digits
// roll when they change, inside a left-to-right box so "120/280" keeps its order in Hebrew text. The text is read
// once; the counter is not a live region. The admin's off switch (old look) gives plain text. Until the chunk loads, the plain number shows at the same height, so the row does not jump.
export default function Count({ value, max = null }) {
  const suffix = max === null ? '' : `/${max}`
  if (getKit() !== 'rare') return `${value}${suffix}`
  return (
    <span dir="ltr" className="inline-flex [unicode-bidi:isolate]">
      <LoadBoundary fallback={value}>
        <Suspense fallback={<span className="inline-flex h-(--counter-line) items-center">{value}</span>}>
          <RareCounter value={value} />
        </Suspense>
      </LoadBoundary>
      {suffix}
    </span>
  )
}
