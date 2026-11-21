import { useEffect, useId, useRef, useState } from 'react'
import Button from './Button'
import { useDismiss } from '../utils/useDismiss'
import './Menu.css'

const ITEM = '[role="menuitem"]'

// A button that opens a list of actions. From 768 px the list is a popover under the button; below it, a sheet above the
// phone bar. Arrow keys, Home and End move between items; Escape and Tab close it; Escape gives focus back to the button.
export default function Menu({ trigger, items, title }) {
  const [open, setOpen] = useState(false)
  const container = useRef(null)
  const listId = useId()
  const titleId = useId()

  // Closes on Escape and on a press outside the menu.
  useDismiss(open, container, setOpen)

  // Opening moves focus to the first item, so the keyboard can use the list straight away.
  useEffect(() => {
    if (open) container.current?.querySelector(ITEM)?.focus()
  }, [open])

  const close = (returnFocus) => {
    setOpen(false)
    if (returnFocus) container.current?.querySelector('[aria-haspopup="menu"]')?.focus()
  }

  const choose = (item) => {
    close(false)
    item.onSelect()
  }

  // Tab is not prevented: the browser moves focus, and the menu closes when focus leaves it (onBlur below).
  const onFocusOut = (event) => {
    if (open && !container.current.contains(event.relatedTarget)) setOpen(false)
  }

  const onKeyDown = (event) => {
    const list = [...event.currentTarget.querySelectorAll(ITEM)]
    const index = list.indexOf(document.activeElement)
    if (event.key === 'Tab') return
    if (event.key === 'Escape') close(true)
    else if (event.key === 'ArrowDown') list[(index + 1) % list.length]?.focus()
    else if (event.key === 'ArrowUp') list[(index - 1 + list.length) % list.length]?.focus()
    else if (event.key === 'Home') list[0]?.focus()
    else if (event.key === 'End') list[list.length - 1]?.focus()
    else return
    event.preventDefault()
  }

  return (
    <div className="ui-menu" ref={container} onBlur={onFocusOut}>
      <Button
        variant={trigger.variant}
        icon={trigger.icon}
        disabled={trigger.disabled}
        loading={trigger.loading}
        title={trigger.title}
        ariaLabel={trigger.label}
        haspopup="menu"
        expanded={open}
        controls={listId}
        onClick={() => setOpen(!open)}
      >
        {trigger.label}
      </Button>
      {open && (
        <div className="ui-menu__panel">
          {title && (
            <p id={titleId} className="ui-menu__title">
              {title}
            </p>
          )}
          <div
            id={listId}
            className="ui-menu__list"
            role="menu"
            aria-labelledby={title ? titleId : undefined}
            aria-label={title ? undefined : trigger.label}
            onKeyDown={onKeyDown}
          >
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={`ui-menu__item${item.tone === 'danger' ? ' ui-menu__item--danger' : ''}`}
                onClick={() => choose(item)}
              >
                <span className="ui-menu__label">{item.label}</span>
                {item.description && <span className="ui-menu__description">{item.description}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
