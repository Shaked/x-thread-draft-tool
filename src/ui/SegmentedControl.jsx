import { useId } from 'react'
import './SegmentedControl.css'

// A radio group drawn as segments. Native radios share one name, so the arrow keys move between them.
// `options`: [{ value, label }]. `orientation: 'column'` stacks the segments (inside the drawer).
export default function SegmentedControl({ legend, value, options, onChange, orientation = 'row' }) {
  const name = useId()
  return (
    <fieldset className={`ui-segmented ui-segmented--${orientation}`}>
      <legend className="ui-segmented__legend">{legend}</legend>
      <div className="ui-segmented__options">
        {options.map((option) => {
          const active = value === option.value
          return (
            <label key={option.value} className={`ui-segmented__option${active ? ' ui-segmented__option--active' : ''}`}>
              <input
                type="radio"
                className="ui-segmented__input"
                name={name}
                value={option.value}
                checked={active}
                onChange={() => onChange(option.value)}
              />
              <span>{option.label}</span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
