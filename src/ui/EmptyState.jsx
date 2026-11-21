import './EmptyState.css'

// A list with nothing in it: a title, an optional line, and one action. Centered, with room around it.
export default function EmptyState({ title, description, action }) {
  return (
    <div className="ui-empty-state">
      <h2 className="ui-empty-state__title">{title}</h2>
      {description && <p className="ui-empty-state__description">{description}</p>}
      {action && <div className="ui-empty-state__action">{action}</div>}
    </div>
  )
}
