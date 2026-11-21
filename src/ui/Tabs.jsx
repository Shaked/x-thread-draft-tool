import { useRef } from 'react'
import './Tabs.css'

// A row of tabs. Arrow keys move between them (Home and End jump to the ends; Left and Right swap in RTL) and
// move the focus with them. The count, when given, stays in the text as " (3)", so the tab's name is "Drafts (3)".
export default function Tabs({ label, tabs, value, onChange }) {
  const buttons = useRef([])

  const move = (index, event) => {
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl'
    const last = tabs.length - 1
    const next = {
      ArrowRight: rtl ? index - 1 : index + 1,
      ArrowLeft: rtl ? index + 1 : index - 1,
      Home: 0,
      End: last
    }[event.key]
    if (next === undefined) return
    event.preventDefault()
    const target = (next + tabs.length) % tabs.length
    buttons.current[target]?.focus()
    onChange(tabs[target].id)
  }

  return (
    <div role="tablist" aria-label={label} className="ui-tabs">
      {tabs.map((tab, index) => {
        const selected = tab.id === value
        return (
          <button
            key={tab.id}
            ref={(element) => {
              buttons.current[index] = element
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className={selected ? 'ui-tabs__tab ui-tabs__tab--selected' : 'ui-tabs__tab'}
            onClick={() => onChange(tab.id)}
            onKeyDown={(event) => move(index, event)}
          >
            <span>{tab.label}</span>
            {tab.count !== undefined && (
              <>
                {' '}
                <span className="ui-tabs__count">({tab.count})</span>
              </>
            )}
          </button>
        )
      })}
    </div>
  )
}
