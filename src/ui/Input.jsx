import { useContext } from 'react'
import { FieldContext } from './Field'
import './Input.css'

// A text box. Inside a Field it takes the label's id and the help or error link; `dir="auto"` makes typed Hebrew run
// right to left. `onChange` gets the new text, not the event.
export default function Input({ value, onChange, type = 'text', placeholder, maxLength, dir = 'auto', disabled = false, ariaLabel }) {
  const field = useContext(FieldContext)
  return (
    <input
      className="ui-input"
      id={field?.id}
      type={type}
      value={value}
      placeholder={placeholder}
      maxLength={maxLength}
      dir={dir}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-describedby={field?.describedBy}
      aria-invalid={field?.invalid || undefined}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}
