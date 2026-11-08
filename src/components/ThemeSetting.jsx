import { useState } from 'react'
import { getTheme, setTheme, THEMES } from '../utils/theme'

const LABELS = { light: 'Light', dark: 'Dark', system: 'Match device' }

// Three-segment radio group. Radios share one name, so the arrow keys move between them.
export default function ThemeSetting() {
  const [value, setValue] = useState(getTheme)

  const choose = (next) => setValue(setTheme(next))

  return (
    <fieldset className="theme-setting">
      <legend>Theme</legend>
      <div className="theme-segments">
        {THEMES.map((option) => (
          <label key={option} className={`theme-segment ${value === option ? 'active' : ''}`}>
            <input
              type="radio"
              name="theme"
              value={option}
              checked={value === option}
              onChange={() => choose(option)}
            />
            <span>{LABELS[option]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
