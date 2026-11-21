import './Inline.css'

// A horizontal row. `equal` gives every child the same width (a group of choices).
export default function Inline({ gap = 2, align = 'start', wrap = true, equal = false, children }) {
  const className = [
    'ui-inline',
    `ui-inline--gap-${gap}`,
    `ui-inline--${align}`,
    wrap ? 'ui-inline--wrap' : '',
    equal ? 'ui-inline--equal' : ''
  ]
    .filter(Boolean)
    .join(' ')
  return <div className={className}>{children}</div>
}
