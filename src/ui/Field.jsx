import { createContext, useId } from 'react'
import './Field.css'

// The label, id and help or error state of one field. Input and Select read it from here, so the label is wired to
// the control without a className or an id on the page.
export const FieldContext = createContext(null)

// A label, one control, and its help or error text. The text under the control is linked to it by aria-describedby.
export default function Field({ label, help, error, children }) {
  const id = useId()
  const helpId = useId()
  const errorId = useId()
  const describedBy = [help ? helpId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined
  return (
    <FieldContext.Provider value={{ id, describedBy, invalid: !!error }}>
      <div className="ui-field">
        <label className="ui-field__label" htmlFor={id}>{label}</label>
        {children}
        {help && <p id={helpId} className="ui-field__help">{help}</p>}
        {error && <p id={errorId} className="ui-field__error">{error}</p>}
      </div>
    </FieldContext.Provider>
  )
}
