import './Stack.css'

// Vertical flex: the only way to space siblings up and down. `gap` is a space token step.
export default function Stack({ gap = 3, as: Tag = 'div', children }) {
  return <Tag className={`ui-stack ui-stack--gap-${gap}`}>{children}</Tag>
}
