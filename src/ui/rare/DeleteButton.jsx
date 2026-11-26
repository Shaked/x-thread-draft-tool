/*
 * Delete button from Rare UI (https://rareui.com), components/ui/delete-button.tsx at commit
 * 0e9f0ef86bd690b16175fb81950ce38a5e689cd4 of github.com/swamimalode07/rare-ui.
 * Copyright (c) 2026 Swami Malode. MIT + Commons Clause License Condition v1.0 + Attribution:
 * the full licence text is in THIRD_PARTY_LICENSES/rare-ui.md. Keep this notice.
 * Changes for this app: TypeScript removed; colours, sizes, radii and shadows come from src/styles/tokens.css
 * (the widths motion animates are read from --hit-min and --space-1); every button is 44 px; the panel is a
 * group named by the question, with the sentence as its description; Cancel comes first and gets focus when
 * the panel opens; logical (start/end) positions and a mirrored notch for right-to-left; the "kept" nudge is a
 * keyframe animation instead of a style-bound value; the panel fades without a sideways slide; the base focus
 * ring; ui-rare-* classes for the UI audit. Motion timings are upstream's; reduced motion makes them instant.
 * Removed: the onCancel prop, className and the rest-props spread; the trigger and yes names come from props
 * (upstream: "Delete" and "Confirm delete"). One open asks once: a second choice while the panel closes is
 * ignored. onConfirm is awaited: while it runs the trigger is busy (aria-busy, presses ignored) and the bin stays;
 * the check mark and "Deleted" come only after it succeeds; false or a rejection goes back to idle, silently
 * (the caller reports the error), and the next press opens the panel again.
 */
import { useEffect, useId, useRef, useState } from 'react'
import { animate, AnimatePresence, motion, useMotionTemplate, useMotionValue, useReducedMotion, useTransform } from 'motion/react'
import '../../styles/rare-kit.css'
import { cn } from './cn'
import { tokenPx } from './tokens'

// Bin geometry, in the icon's 24 x 24 viewBox units.
const LID_OPEN = -35
const WALL_TOP = 6
const WALL_TOP_OPEN = 13.5
const WALL_BASE = 20

const HOLD = { deleted: 1400, kept: 600 }

const EASE = [0.32, 0.72, 0, 1]
const EASE_LID = [0.34, 1.1, 0.64, 1]

const WIDTH = { duration: 0.62, ease: EASE }
const LID = { duration: 0.6, ease: EASE_LID }
const WALL = { duration: 0.56, ease: EASE }
const IN = { duration: 0.44, ease: EASE, delay: 0.14 }
const OUT = { duration: 0.3, ease: EASE }
const TAP = { duration: 0.2, ease: EASE }
const SWAP = { duration: 0.22, ease: EASE }
const SETTLE = { duration: 0.45, ease: EASE }
const PRESS = { type: 'spring', stiffness: 520, damping: 18, mass: 0.5 }
const INSTANT = { duration: 0 }

const SURFACE = 'bg-(--color-surface-2)'
const RECESS = 'bg-(--color-surface)'
const GLYPH = 'text-(--color-text-soft)'
// The base focus ring, drawn inside so the panel's edges never cut it.
const FOCUS_INSIDE = 'focus-visible:[outline-offset:calc(var(--focus-ring-width)*-1)]'

const CIRCLE = `ui-rare-delete__choice grid size-(--hit-min) cursor-pointer text-(length:--font-size-md) place-items-center rounded-(--radius-full) border-0 p-(--space-0) shadow-(--shadow-sm) transition-colors duration-(--duration-base) ease-(--ease-standard) hover:bg-(--color-surface-raised) ${FOCUS_INSIDE} ${SURFACE}`

const ICON = {
  viewBox: '0 0 24 24',
  fill: 'none',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true
}

const panelMotion = {
  hidden: { opacity: 0, transition: OUT },
  shown: { opacity: 1, transition: { ...IN, staggerChildren: 0.07 } }
}

const circleMotion = {
  hidden: { opacity: 0, scale: 0.9, transition: OUT },
  shown: { opacity: 1, scale: 1, transition: IN }
}

function Circle({ label, onClick, buttonRef, tone, children }) {
  const reduced = useReducedMotion() ?? false

  return (
    <motion.div className="flex" variants={reduced ? undefined : circleMotion}>
      <motion.button
        ref={buttonRef}
        type="button"
        aria-label={label}
        onClick={onClick}
        whileHover={reduced ? undefined : { scale: 1.03 }}
        whileTap={reduced ? undefined : { scale: 0.84 }}
        transition={PRESS}
        className={cn(CIRCLE, tone)}
      >
        <svg {...ICON} className="size-(--icon-size)" stroke="currentColor" strokeWidth="3">
          {children}
        </svg>
      </motion.button>
    </motion.div>
  )
}

// `label` names the button ("Delete draft"); `question` names the open panel ("Delete this draft?") and
// `description` is the sentence read with it; `confirmLabel` names the yes button. `onConfirm` runs on yes only.
export default function DeleteButton({ label, question, description, confirmLabel, onConfirm }) {
  const reduced = useReducedMotion() ?? false
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState('idle')
  const [size] = useState(() => ({ tile: tokenPx('--hit-min'), panel: 2 * tokenPx('--hit-min') + 3 * tokenPx('--space-1') }))
  const trigger = useRef(null)
  const cancel = useRef(null)
  // One choice per open (a double press, or a press while the panel fades out, is ignored).
  const settled = useRef(false)
  // False once unmounted: the row is removed when the delete succeeds, before onConfirm's promise may settle.
  const alive = useRef(true)
  const panelId = useId()
  const descriptionId = useId()
  const timing = (transition) => (reduced ? INSTANT : transition)

  const top = useMotionValue(WALL_TOP)
  const wall = useTransform(top, (y) => WALL_BASE - y)
  const bin = useMotionTemplate`M19 ${top}v${wall}a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V${top}`

  useEffect(() => {
    const walls = animate(top, open ? WALL_TOP_OPEN : WALL_TOP, reduced ? INSTANT : WALL)
    return () => walls.stop()
  }, [open, reduced, top])

  useEffect(() => {
    if (open) cancel.current?.focus()
  }, [open])

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    if (status === 'idle' || status === 'busy') return
    const done = setTimeout(() => setStatus('idle'), HOLD[status])
    return () => clearTimeout(done)
  }, [status])

  // `onConfirm` may return a promise. false or a rejection means the delete failed: back to idle, no "Deleted".
  const resolve = async (next) => {
    if (settled.current) return
    settled.current = true
    setOpen(false)
    trigger.current?.focus()
    if (next === 'kept') return setStatus('kept')
    setStatus('busy')
    let ok = false
    try {
      ok = (await onConfirm()) !== false
    } catch {
      ok = false
    }
    if (alive.current) setStatus(ok ? 'deleted' : 'idle')
  }

  return (
    <motion.div
      data-slot="delete-button"
      data-state={open ? 'open' : 'closed'}
      data-status={status}
      className={cn('ui-rare-delete relative h-(--hit-min) rounded-(--radius-lg)', SURFACE, GLYPH)}
      animate={{ width: open ? size.tile + size.panel : size.tile }}
      transition={timing(WIDTH)}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) resolve('kept')
      }}
    >
      <motion.button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-busy={status === 'busy' || undefined}
        aria-disabled={status === 'busy' || undefined}
        onClick={() => {
          if (status === 'busy') return
          if (open) return resolve('kept')
          settled.current = false
          setStatus('idle')
          setOpen(true)
        }}
        whileTap={reduced ? undefined : { scale: 0.94 }}
        transition={TAP}
        className={cn(
          'ui-rare-delete__trigger relative z-(--z-raised) grid size-(--hit-min) cursor-pointer text-(length:--font-size-md) place-items-center rounded-(--radius-lg) border-0 bg-transparent p-(--space-0)',
          FOCUS_INSIDE
        )}
      >
        <AnimatePresence mode="wait" initial={false}>
          {status === 'deleted' ? (
            <motion.svg
              key="done"
              {...ICON}
              className="size-(--icon-size) text-(--color-success)"
              stroke="currentColor"
              strokeWidth="2.5"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={timing(SWAP)}
            >
              <motion.path
                d="M4 12.5 9.5 18 20 7"
                initial={reduced ? undefined : { pathLength: 0 }}
                animate={reduced ? undefined : { pathLength: 1 }}
                transition={SETTLE}
              />
            </motion.svg>
          ) : (
            <motion.svg
              key="bin"
              {...ICON}
              className="size-(--icon-size) overflow-visible"
              stroke="currentColor"
              strokeWidth="2"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, scale: status === 'kept' && !reduced ? [1, 0.86, 1] : 1 }}
              exit={{ opacity: 0 }}
              transition={{ ...timing(SWAP), scale: SETTLE }}
            >
              <motion.path d={bin} />
              <motion.g className="[transform-box:view-box] origin-[12.5%_25%]" animate={{ rotate: open ? LID_OPEN : 0 }} transition={timing(LID)}>
                <path d="M3 6h18" />
                <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              </motion.g>
            </motion.svg>
          )}
        </AnimatePresence>
      </motion.button>

      <span role="status" aria-live="polite" className="sr-only">
        {status === 'deleted' ? 'Deleted' : status === 'kept' ? 'Kept' : ''}
      </span>

      <AnimatePresence>
        {open && (
          <motion.div
            key="panel"
            id={panelId}
            role="group"
            aria-label={question}
            aria-describedby={descriptionId}
            className={cn('ui-rare-delete__panel absolute inset-y-(--space-0) end-(--space-0) flex w-max items-center justify-center gap-(--space-1) rounded-(--radius-lg) px-(--space-1)', RECESS)}
            variants={reduced ? undefined : panelMotion}
            initial="hidden"
            animate="shown"
            exit="hidden"
          >
            <span id={descriptionId} className="sr-only">
              {description}
            </span>
            <span
              aria-hidden="true"
              className={cn(
                'absolute -start-(--space-1) top-[50%] z-(--z-raised) h-(--space-2) w-(--space-1) -translate-y-[50%] [clip-path:polygon(100%_0,0_50%,100%_100%)] rtl:[clip-path:polygon(0_0,100%_50%,0_100%)]',
                RECESS
              )}
            />
            <Circle label="Cancel" buttonRef={cancel} onClick={() => resolve('kept')}>
              <path d="M6 6 18 18M18 6 6 18" />
            </Circle>
            <Circle label={confirmLabel} tone="text-(--color-danger)" onClick={() => resolve('deleted')}>
              <path d="M4 12.5 9.5 18 20 7" />
            </Circle>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
