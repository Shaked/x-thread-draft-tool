import { useState } from 'react'
import { getTheme, setTheme, THEMES } from '../utils/theme'
import ThemePicker from '../ui/ThemePicker'

const LABELS = { light: 'Light', dark: 'Dark', system: 'Match device' }

// The theme choice inside the menu drawer: one segment per theme, stacked (or Rare UI's theme selector, feature flag).
export default function ThemeSetting() {
  const [value, setValue] = useState(getTheme)

  const choose = (next) => setValue(setTheme(next))

  return (
    <ThemePicker
      legend="Theme"
      value={value}
      onChange={choose}
      options={THEMES.map((option) => ({ value: option, label: LABELS[option] }))}
    />
  )
}
