import { useState } from 'react'
import { getTheme, setTheme, THEMES } from '../utils/theme'
import SegmentedControl from '../ui/SegmentedControl'

const LABELS = { light: 'Light', dark: 'Dark', system: 'Match device' }

// The theme choice inside the menu drawer: one segment per theme, stacked.
export default function ThemeSetting() {
  const [value, setValue] = useState(getTheme)

  const choose = (next) => setValue(setTheme(next))

  return (
    <SegmentedControl
      legend="Theme"
      orientation="column"
      value={value}
      onChange={choose}
      options={THEMES.map((option) => ({ value: option, label: LABELS[option] }))}
    />
  )
}
