import { Link } from 'react-router-dom'
import './List.css'

// A list of rows. Put it in a Card with padding "none" so the rows sit on one surface.
export function List({ children }) {
  return <ul className="ui-list">{children}</ul>
}

// One row: a title, a line of meta text, an optional badge, extra content, and actions at the end (under them on
// phones). The title is user text, so it gets dir="auto". With `to`, the title is a link and the whole row is
// clickable (a stretched link); the actions stay above it and keep their own buttons.
export function ListItem({ title, to, meta = [], badge, actions, children }) {
  return (
    <li className={to ? 'ui-list-item ui-list-item--link' : 'ui-list-item'}>
      <div className="ui-list-item__body">
        <div className="ui-list-item__head">
          <p className="ui-list-item__title" dir="auto">
            {to ? <Link to={to} className="ui-list-item__link">{title}</Link> : title}
          </p>
          {badge}
        </div>
        {meta.length > 0 && (
          <div className="ui-list-item__meta">
            {meta.map((item, index) => (
              <span key={index}>{item}</span>
            ))}
          </div>
        )}
        {children}
      </div>
      {actions && <div className="ui-list-item__actions">{actions}</div>}
    </li>
  )
}
