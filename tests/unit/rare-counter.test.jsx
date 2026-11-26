import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
import Count from '../../src/ui/Count.jsx'
import { KIT_KEY } from '../../src/utils/skin.js'

// The 280-character counter behind the "Components" feature flag (#406, Rare UI animated counter), through src/ui/Count.jsx.
// The counter's own chunk loads after the first render, so the flag-on tests wait for the rolling digits.
const rareCounter = (container) => container.querySelector('.ui-rare-counter')

describe('Count (Rare UI animated counter, feature flag)', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('shows today\'s plain "value/max" text with the flag off, and no counter', () => {
    const { container } = render(<Count value={0} max={280} />)
    expect(container.textContent).toBe('0/280')
    expect(rareCounter(container)).toBeNull()
  })

  it('reads the number and follows it as the text changes, with the flag on', async () => {
    localStorage.setItem(KIT_KEY, 'rare')
    const { container, rerender } = render(<Count value={120} max={280} />)
    await waitFor(() => expect(rareCounter(container)).not.toBeNull())
    expect(container.querySelector('.sr-only').textContent).toBe('120')
    expect(container.textContent).toContain('/280')
    rerender(<Count value={121} max={280} />)
    expect(container.querySelector('.sr-only').textContent).toBe('121')
  })

  it('moves the digit wheel with a transform, so the shown digits are not stuck at zero', async () => {
    localStorage.setItem(KIT_KEY, 'rare')
    const { container } = render(<Count value={157} max={280} />)
    await waitFor(() => expect(rareCounter(container)).not.toBeNull())
    const wheels = [...container.querySelectorAll('[data-slot="animated-counter-digit"] > span:last-child')]
    expect(wheels).toHaveLength(3)
    expect(wheels.every((w) => /translateY\(-?[1-9]/.test(w.style.transform))).toBe(true)
  })

  it('is not a live region: nothing announces each keystroke', async () => {
    localStorage.setItem(KIT_KEY, 'rare')
    const { container } = render(<Count value={7} max={280} />)
    await waitFor(() => expect(rareCounter(container)).not.toBeNull())
    expect(container.querySelector('[aria-live], [role="status"], [role="alert"]')).toBeNull()
  })

  it('keeps the digits left to right inside a Hebrew (right-to-left) text box', async () => {
    localStorage.setItem(KIT_KEY, 'rare')
    const { container } = render(
      <div dir="rtl">
        <Count value={290} max={280} />
      </div>
    )
    await waitFor(() => expect(rareCounter(container)).not.toBeNull())
    const box = container.querySelector('[dir="ltr"]')
    expect(box).not.toBeNull()
    expect(box.querySelector('.sr-only').textContent).toBe('290')
    expect(box.textContent).toContain('/280')
  })
})
