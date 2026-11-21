import { useContext } from 'react'
import { FieldContext } from './Field'
import './Select.css'

// A native select, so phones keep their own pickers. `onChange` gets the chosen value as text.
export default function Select({ value, onChange, options, disabled = false }) {
  const field = useContext(FieldContext)
  return (
    <select
      className="ui-select"
      id={field?.id}
      value={value}
      disabled={disabled}
      aria-describedby={field?.describedBy}
      aria-invalid={field?.invalid || undefined}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}
