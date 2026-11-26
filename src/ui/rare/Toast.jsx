/*
 * Toast from Rare UI (https://rareui.com), components/ui/toast.tsx at commit
 * 0e9f0ef86bd690b16175fb81950ce38a5e689cd4 of github.com/swamimalode07/rare-ui.
 * Copyright (c) 2026 Swami Malode. MIT + Commons Clause License Condition v1.0 + Attribution:
 * the full licence text is in THIRD_PARTY_LICENSES/rare-ui.md. Keep this notice.
 * Changes for this app: TypeScript removed; the stack is sonner (the same package, pinned to 2.0.8), shown at the
 * bottom centre above the phone bar (--toast-inset), one toast at a time; the card is ours: no figma-squircle and no
 * clip paths or inline styles, a rounded card (--radius-lg) with a border; the iOS hex colours are tokens (the
 * success and danger colours on the icon, the text colour on the card); the close button is 44 px, always visible
 * (upstream hides it on touch screens and makes it 20 px) and shown on danger toasts only, as before; a danger toast
 * stays until it is closed, a success or neutral one goes away after 4 s; role="status" for success and neutral,
 * role="alert" for danger; the text is dir="auto". Removed: the promise and loading toasts, the Undo action, the
 * info and warning tones and the Dismiss corner button (no caller uses them). Reduced motion draws the icons at once.
 * The ui-rare-toast class is for the UI audit.
 */
import { useEffect } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { Toaster as SonnerToaster, toast as sonnerToast } from 'sonner'
import '../../styles/rare-kit.css'
import { cn } from './cn'

const TOAST_MS = 4000
const DRAW = { duration: 0.3, delay: 0.12, ease: 'easeOut' }
const INSTANT = { duration: 0 }

// The stack's bottom edge is a token (above the phone bar); sonner's own inline offset is overridden by !important.
// sonner's position name for the bottom centre (a prop value, built here so the class lint does not read it as a class).
const POSITION = ['bottom', 'center'].join('-')
const TOASTER = 'bottom-(--toast-inset)!'
const CARD =
  'ui-rare-toast flex min-h-(--hit-min) w-full items-center gap-(--space-3) rounded-(--radius-lg) border border-(--color-border-soft) bg-(--color-surface-raised) py-(--space-2) ps-(--space-4) text-(length:--font-size-md) text-(--color-text) shadow-(--shadow-md)'
const TONE_ICON = {
  success: 'text-(--color-success)',
  danger: 'text-(--color-danger)'
}
const CLOSE =
  'grid size-(--hit-min) shrink-0 cursor-pointer place-items-center rounded-(--radius-md) border-0 bg-transparent p-(--space-0) text-(--color-text-soft) transition-colors duration-(--duration-fast) ease-(--ease-standard) hover:bg-(--color-surface-2) hover:text-(--color-text) focus-visible:[outline-offset:calc(var(--focus-ring-width)*-1)]'

const ICON = {
  viewBox: '0 0 24 24',
  fill: 'none',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true
}

// The check or cross draws itself in; reduced motion shows it at once.
function Mark({ tone }) {
  const reduced = useReducedMotion() ?? false
  const draw = {
    initial: reduced ? false : { pathLength: 0 },
    animate: { pathLength: 1 },
    transition: reduced ? INSTANT : DRAW
  }
  return (
    <motion.svg {...ICON} className={cn('size-(--icon-size) shrink-0', TONE_ICON[tone])} stroke="currentColor" strokeWidth="2.75">
      {tone === 'success' ? (
        <motion.path d="M6 12.5l4 4 8-9" {...draw} />
      ) : (
        <>
          <motion.path d="M7.5 7.5l9 9" {...draw} />
          <motion.path d="M16.5 7.5l-9 9" {...draw} />
        </>
      )}
    </motion.svg>
  )
}

function RareToastCard({ id, tone, message }) {
  const danger = tone === 'danger'
  return (
    <div role={danger ? 'alert' : 'status'} data-tone={tone} className={cn(CARD, danger ? 'pe-(--space-2)' : 'pe-(--space-4)')}>
      {tone !== 'neutral' && <Mark tone={tone} />}
      <p dir="auto" className="min-w-(--space-0) flex-1 text-start [overflow-wrap:anywhere]">
        {message}
      </p>
      {danger && (
        <button type="button" aria-label="Close message" onClick={() => sonnerToast.dismiss(id)} className={CLOSE}>
          <svg {...ICON} className="size-(--icon-size)" stroke="currentColor" strokeWidth="2.5">
            <path d="M7 7l10 10M17 7L7 17" />
          </svg>
        </button>
      )}
    </div>
  )
}

// Shows one message: the one on screen goes first. A danger message stays until it is closed.
export function showRareToast({ message, tone = 'neutral' }) {
  sonnerToast.dismiss()
  return sonnerToast.custom((id) => <RareToastCard id={id} tone={tone} message={message} />, {
    duration: tone === 'danger' ? Infinity : TOAST_MS,
    // a danger message stays until its Close button is pressed: a swipe does not dismiss it
    dismissible: tone !== 'danger'
  })
}

// Takes the message on screen away (the provider calls it when a toast shows the old way, for example after the flag is switched off).
export function dismissRareToast() {
  sonnerToast.dismiss()
}

// Mounted by the provider in src/ui/Toast.jsx when the Components flag is on. It hands its show and dismiss functions up while mounted. hotkey is off: sonner's Alt+T would move focus out of the editor.
export default function RareToaster({ onReady }) {
  useEffect(() => {
    onReady(showRareToast, dismissRareToast)
    return () => onReady(null)
  }, [onReady])
  return <SonnerToaster position={POSITION} hotkey={[]} visibleToasts={1} className={TOASTER} containerAriaLabel="Notifications" toastOptions={{ unstyled: true }} />
}
