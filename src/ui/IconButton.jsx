import { forwardRef, useId } from 'react'
import Icon from './Icon'
import './IconButton.css'

// An icon-only button: always 44 x 44. `label` is required (aria-label and the tooltip). `ref` goes to the button.
// `handleProps` is spread on the button first (the drag handle's dnd-kit listeners and attributes); the props below win.
const IconButton = forwardRef(function IconButton(
  { icon, label, variant = 'ghost', pressed, expanded, controls, disabled = false, disabledReason, handleProps, onClick },
  ref
) {
  const reasonId = useId()
  const className = ['ui-icon-button', `ui-icon-button--${variant}`, pressed ? 'ui-icon-button--pressed' : ''].filter(Boolean).join(' ')
  return (
    <>
      <button
        ref={ref}
        type="button"
        {...handleProps}
        className={className}
        aria-label={label}
        aria-pressed={pressed}
        aria-expanded={expanded}
        aria-controls={controls}
        title={disabledReason || label}
        disabled={disabled && !disabledReason}
        aria-disabled={disabled || disabledReason ? true : undefined}
        aria-describedby={[handleProps?.['aria-describedby'], disabledReason ? reasonId : null].filter(Boolean).join(' ') || undefined}
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
})

export default IconButton
