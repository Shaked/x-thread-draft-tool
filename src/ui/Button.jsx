import { useId } from 'react'
import { Link } from 'react-router-dom'
import Icon from './Icon'
import './Button.css'

// The inside of a button: its icon (or the spinner while loading) and its label. Both labels share one grid cell,
// so the button keeps its width; the one not shown is hidden from screen readers too.
function ButtonContent({ icon, loading, loadingLabel, children }) {
  return (
    <>
      {loading ? <span className="ui-button__spinner" aria-hidden="true" /> : icon && <Icon name={icon} />}
      <span className="ui-button__stack">
        <span className={`ui-button__text${loading ? ' ui-button__text--inactive' : ''}`} aria-hidden={loading || undefined}>
          {children}
        </span>
        {loading && <span className="ui-button__text">{loadingLabel ?? children}</span>}
      </span>
    </>
  )
}

// A button, or a link that looks like one (`to` or `href`). `loading` keeps the width and ignores clicks.
// `disabledReason` keeps the button focusable (aria-disabled) and shows the reason as help text.
// `haspopup`, `expanded` and `controls` describe a button that opens a menu (see Menu).
export default function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  loading = false,
  loadingLabel,
  disabled = false,
  disabledReason,
  fullWidth = false,
  type = 'button',
  to,
  href,
  onClick,
  ariaLabel,
  title,
  haspopup,
  expanded,
  controls,
  children
}) {
  const reasonId = useId()
  const blocked = disabled || loading || !!disabledReason
  const className = ['ui-button', `ui-button--${variant}`, `ui-button--${size}`, fullWidth ? 'ui-button--full' : ''].filter(Boolean).join(' ')

  const handleClick = (event) => {
    if (blocked) {
      event.preventDefault()
      return
    }
    onClick?.(event)
  }

  const shared = {
    className,
    onClick: handleClick,
    'aria-disabled': disabled || disabledReason ? true : undefined,
    'aria-label': ariaLabel,
    'aria-haspopup': haspopup,
    'aria-expanded': expanded,
    'aria-controls': controls,
    'aria-describedby': disabledReason ? reasonId : undefined,
    title: disabledReason || title
  }
  const content = <ButtonContent icon={icon} loading={loading} loadingLabel={loadingLabel}>{children}</ButtonContent>

  let control
  if (to) control = <Link to={to} {...shared}>{content}</Link>
  else if (href) control = <a href={href} {...shared}>{content}</a>
  else {
    control = (
      <button type={type} disabled={disabled && !disabledReason} aria-busy={loading || undefined} {...shared}>
        {content}
      </button>
    )
  }

  return (
    <>
      {control}
      {disabledReason && (
        <span id={reasonId} className="ui-button__reason">
          {disabledReason}
        </span>
      )}
    </>
  )
}
