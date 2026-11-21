import { useId } from 'react'
import './Section.css'

// A titled group of a page. The title is a heading; the section is labelled by it.
export default function Section({ title, description, actions, children, headingLevel = 2 }) {
  const id = useId()
  const Heading = `h${headingLevel}`
  return (
    <section className="ui-section" aria-labelledby={id}>
      <div className="ui-section__head">
        <div className="ui-section__text">
          <Heading id={id} className={`ui-section__title ui-section__title--h${headingLevel}`}>
            {title}
          </Heading>
          {description && <p className="ui-section__description">{description}</p>}
        </div>
        {actions && <div className="ui-section__actions">{actions}</div>}
      </div>
      <div className="ui-section__body">{children}</div>
    </section>
  )
}
