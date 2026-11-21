import './DescriptionList.css'

// Term and value pairs. `columns` 2 puts the pairs side by side from 768 px.
export default function DescriptionList({ items, columns = 1 }) {
  return (
    <dl className={`ui-description-list ui-description-list--cols-${columns}`}>
      {items.map((item) => (
        <div key={item.term} className="ui-description-list__item">
          <dt className="ui-description-list__term">{item.term}</dt>
          <dd className="ui-description-list__value">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}
