import { lazy, Suspense } from 'react'
import { getKit } from '../utils/skin'
import SegmentedControl from './SegmentedControl'

// Rare UI's theme selector (feature flag "Components", src/utils/skin.js). Its chunk loads only when the flag is on.
const RareThemeSelector = lazy(() => import('./rare/ThemeSelector.jsx'))

// The theme choice. Flag off (default): a SegmentedControl in a column. Flag on: Rare UI's theme selector, a
// small preview of each theme drawn from the tokens. `options`: [{ value: 'light' | 'dark' | 'system', label }].
export default function ThemePicker({ legend, value, options, onChange }) {
  const current = <SegmentedControl legend={legend} orientation="column" value={value} options={options} onChange={onChange} />
  if (getKit() !== 'rare') return current
  return (
    <Suspense fallback={current}>
      <RareThemeSelector legend={legend} value={value} options={options} onChange={onChange} />
    </Suspense>
  )
}
