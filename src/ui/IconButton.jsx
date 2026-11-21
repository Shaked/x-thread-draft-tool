import { useId } from 'react'
import Icon from './Icon'
import './IconButton.css'

// An icon-only button: always 44 x 44. `label` is required (aria-label and the tooltip).
export default function IconButton({ icon, label, variant = 'ghost', pressed, disabled = false, disabledReason, onClick }) {
  const reasonId = useId()
  const className = ['ui-icon-button', `ui-icon-button--${variant}`, pressed ? 'ui-icon-button--pressed' : ''].filter(Boolean).join(' ')
  return (
    <>
      <button
        type="button"
        className={className}
        aria-label={label}
        aria-pressed={pressed}
        title={disabledReason || label}
        disabled={disabled && !disabledReason}
        aria-disabled={disabled && disabledReason ? true : undefined}
        aria-describedby={disabledReason ? reasonId : undefined}
        onClick={(event) => {
          if (disabled || disabledReason) return event.preventDefault()
          onClick?.(event)
        }}
      >
        <Icon name={icon} />
      </button>
      {disabledReason && (
        <span id={reasonId} className="ui-icon-button__reason">
          {disabledReason}
        </span>
      )}
    </>
  )
}
