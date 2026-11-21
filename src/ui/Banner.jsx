import './Banner.css'

// A message box. Errors use role "alert"; static notes use role "none" (no live region); everything else keeps "status".
export default function Banner({ tone = 'info', title, children, actions, role = 'status' }) {
  return (
    <div className={`ui-banner ui-banner--${tone}`} role={role === 'none' ? undefined : role}>
      <div className="ui-banner__body">
        {title && <p className="ui-banner__title">{title}</p>}
        {children && <div className="ui-banner__text">{children}</div>}
      </div>
      {actions && <div className="ui-banner__actions">{actions}</div>}
    </div>
  )
}
