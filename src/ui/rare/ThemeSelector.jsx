/*
 * Theme selector from Rare UI (https://rareui.com), components/ui/theme-selector.tsx at commit
 * 0e9f0ef86bd690b16175fb81950ce38a5e689cd4 of github.com/swamimalode07/rare-ui.
 * Copyright (c) 2026 Swami Malode. MIT + Commons Clause License Condition v1.0 + Attribution:
 * the full licence text is in THIRD_PARTY_LICENSES/rare-ui.md. Keep this notice.
 * Changes for this app: TypeScript removed; colours, sizes and radii come from src/styles/tokens.css (the
 * preview draws the tokens in each colour scheme, so there are no palette props); a "Match device" preview
 * (light and dark halves); a visible legend; a three-column grid that fits the menu drawer; logical
 * (start/end) positions; arrow keys follow the reading direction; the base focus ring; ui-rare-* classes for
 * the UI audit.
 */
import { useId, useRef } from 'react'
import '../../styles/rare-kit.css'
import { cn } from './cn'

const bar = 'block h-[2.2cqw] rounded-(--radius-full)'
const line = 'border-(length:--border-width) border-(--color-border-soft)'

// The miniature app. data-color-scope re-declares the colour tokens here (src/styles/tokens.css), so they
// follow the colour scheme set on this element, not the page's.
function Preview({ scheme, half = false }) {
  return (
    <span
      aria-hidden="true"
      data-color-scope=""
      data-slot="theme-selector-preview"
      // bleeds past the end and bottom edges so only the top start corner shows
      className={cn(
        'absolute -bottom-[10cqw] -end-[10cqw] start-[13cqw] top-[13cqw] flex rounded-ss-[5cqw] bg-(--color-surface)',
        line,
        scheme === 'dark' ? '[color-scheme:dark]' : '[color-scheme:light]',
        half && '[clip-path:inset(0_0_0_50%)] rtl:[clip-path:inset(0_50%_0_0)]'
      )}
    >
      <span className="flex w-[25cqw] shrink-0 flex-col px-[3cqw] pb-[14cqw] pt-[4cqw]">
        <span className="flex gap-[1.3cqw] px-[1.2cqw]">
          {[0, 1, 2].map((dot) => (
            <span key={dot} className="size-[2cqw] rounded-(--radius-full) bg-(--color-surface-2)" />
          ))}
        </span>
        <span className="mt-[4cqw] flex flex-col gap-[1cqw]">
          <span className="flex h-[4.6cqw] items-center rounded-[1.6cqw] bg-(--color-accent-soft) px-[1.2cqw]">
            <span className={cn(bar, 'w-[10cqw] bg-(--color-accent)')} />
          </span>
          <span className="flex h-[4.6cqw] items-center px-[1.2cqw]">
            <span className={cn(bar, 'w-[13cqw] bg-(--color-surface-2)')} />
          </span>
          <span className="flex h-[4.6cqw] items-center px-[1.2cqw]">
            <span className={cn(bar, 'w-[8cqw] bg-(--color-surface-2)')} />
          </span>
        </span>
        <span className="mt-auto flex items-center gap-[1.6cqw] px-[1.2cqw]">
          <span className="size-[4.4cqw] shrink-0 rounded-(--radius-full) bg-(--color-border)" />
          <span className={cn(bar, 'w-[7cqw] bg-(--color-surface-2)')} />
        </span>
      </span>
      <span className={cn('mt-[3cqw] flex min-w-[0%] flex-1 flex-col overflow-hidden rounded-ss-[4cqw] bg-(--color-bg) ps-[5cqw] pt-[5cqw]', line)}>
        <span className="flex flex-col gap-[2cqw]">
          <span className={cn(bar, 'w-[11cqw] bg-(--color-text)')} />
          <span className={cn(bar, 'w-[19cqw] bg-(--color-text-soft)')} />
        </span>
        <span className="mt-[5cqw] flex gap-[2.5cqw]">
          {[0, 1, 2].map((tile) => (
            <span key={tile} className={cn('h-[12cqw] w-[19cqw] shrink-0 rounded-[2.4cqw] bg-(--color-surface)', line)} />
          ))}
        </span>
        <span className={cn('mt-[2.5cqw] h-[20cqw] w-[70cqw] shrink-0 rounded-[2.4cqw] bg-(--color-surface)', line)} />
      </span>
    </span>
  )
}

// Next and previous in reading order: Right moves back in right-to-left text.
const STEPS = new Map([
  ['ArrowRight', 1],
  ['ArrowDown', 1],
  ['ArrowLeft', -1],
  ['ArrowUp', -1]
])

const ring =
  'pointer-events-none absolute -inset-(--space-1) rounded-(--radius-lg) border-(length:--border-width-strong) transition-opacity duration-(--duration-fast) ease-(--ease-standard)'

// `options`: [{ value: 'light' | 'dark' | 'system', label }]. `value` is the chosen value; `onChange` gets the new one.
export default function ThemeSelector({ legend, value, options, onChange }) {
  const legendId = useId()
  const items = useRef([])
  const selectedIndex = options.findIndex((option) => option.value === value)

  const select = (next) => {
    if (next !== value) onChange(next)
  }

  const onKeyDown = (event, index) => {
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl'
    const flip = rtl && (event.key === 'ArrowLeft' || event.key === 'ArrowRight') ? -1 : 1
    const step = STEPS.get(event.key)
    let target
    if (event.key === 'Home') target = 0
    else if (event.key === 'End') target = options.length - 1
    else if (step) target = (index + step * flip + options.length) % options.length
    else return
    event.preventDefault()
    items.current[target]?.focus()
    select(options[target].value)
  }

  return (
    <div className="ui-rare-theme flex flex-col gap-(--space-2)">
      <p id={legendId} className="ui-rare-theme__legend text-(length:--font-size-sm) [font-weight:var(--font-weight-semibold)] text-(--color-text-soft)">
        {legend}
      </p>
      <div role="radiogroup" aria-labelledby={legendId} data-slot="theme-selector" className="ui-rare-theme__options grid grid-cols-3 gap-(--space-3)">
        {options.map((option, index) => {
          const active = option.value === value
          return (
            <div key={option.value} data-slot="theme-selector-option" className="flex min-w-[0%] flex-col items-center gap-(--space-2)">
              <button
                ref={(el) => {
                  items.current[index] = el
                }}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={option.label}
                // with no match, the first item stays reachable by tab
                tabIndex={(selectedIndex === -1 ? index === 0 : active) ? 0 : -1}
                data-slot="theme-selector-item"
                data-state={active ? 'checked' : 'unchecked'}
                onClick={() => select(option.value)}
                onKeyDown={(event) => onKeyDown(event, index)}
                className="ui-rare-theme__item group relative aspect-[4/3] w-full cursor-pointer text-(length:--font-size-md) rounded-(--radius-lg) border-0 bg-transparent p-(--space-0)"
              >
                <span className="@container absolute inset-(--space-0) overflow-hidden rounded-(--radius-lg) bg-(--color-surface-2) transition-colors duration-(--duration-fast) ease-(--ease-standard) group-hover:bg-(--color-accent-soft)">
                  {option.value === 'system' ? (
                    <>
                      <Preview scheme="light" />
                      <Preview scheme="dark" half />
                    </>
                  ) : (
                    <Preview scheme={option.value} />
                  )}
                </span>
                <span className={cn(ring, 'border-(--color-border) opacity-0', !active && 'group-hover:opacity-100')} />
                <span data-slot="theme-selector-ring" className={cn(ring, 'border-(--color-accent)', active ? 'opacity-100' : 'opacity-0')} />
              </button>
              <span
                aria-hidden="true"
                data-slot="theme-selector-label"
                className={cn(
                  'ui-rare-theme__label text-(length:--font-size-sm) transition-colors duration-(--duration-fast) ease-(--ease-standard)',
                  active ? 'text-(--color-text) [font-weight:var(--font-weight-semibold)]' : 'text-(--color-text-soft)'
                )}
              >
                {option.label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
