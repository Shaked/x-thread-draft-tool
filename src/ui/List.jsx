import './List.css'

// A list of rows. Put it in a Card with padding "none" so the rows sit on one surface.
export function List({ children }) {
  return <ul className="ui-list">{children}</ul>
}

// One row: a title, a line of meta text, an optional badge, extra content, and actions at the end (under them on
// phones). The title is user text, so it gets dir="auto".
export function ListItem({ title, meta = [], badge, actions, children }) {
  return (
    <li className="ui-list-item">
      <div className="ui-list-item__body">
        <div className="ui-list-item__head">
          <p className="ui-list-item__title" dir="auto">{title}</p>
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
