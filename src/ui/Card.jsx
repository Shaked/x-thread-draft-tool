import './Card.css'

// A surface with a soft border. A heading inside a card is 18 px, semibold.
export default function Card({ children, padding = 'md', tone = 'default' }) {
  return <div className={`ui-card ui-card--pad-${padding} ui-card--${tone}`}>{children}</div>
}
