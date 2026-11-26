/*
 * Animated counter from Rare UI (https://rareui.com), components/ui/animated-counter.tsx at commit
 * 0e9f0ef86bd690b16175fb81950ce38a5e689cd4 of github.com/swamimalode07/rare-ui.
 * Copyright (c) 2026 Swami Malode. MIT + Commons Clause License Condition v1.0 + Attribution:
 * the full licence text is in THIRD_PARTY_LICENSES/rare-ui.md. Keep this notice.
 * Changes for this app: TypeScript removed; integer values only (no decimals, prefix, suffix, negative numbers,
 * separators or Indian grouping: the counter shows the same digits as the plain text); no React 19 ref prop: the
 * digit columns forward their ref (forwardRef), which AnimatePresence needs to measure a leaving column; no inline
 * styles: the digit height and the edge fade are tokens (--counter-line, --mask-counter-fade in src/styles/tokens.css),
 * the wheel offset is a motion value bound through the motion element's style prop (the one style prop in this file, allowed in tests/unit/design-tokens.test.js); the digits are set left to right by the caller's dir="ltr" box;
 * the number is read once (sr-only), the rolling digits are aria-hidden, and nothing here is a live region, so
 * the screen reader does not announce each keystroke; the ui-rare-counter class for the UI audit. Motion timings
 * are upstream's; reduced motion makes them instant.
 */
import { forwardRef, memo, useEffect, useMemo, useRef, useState } from 'react'
import { animate, AnimatePresence, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react'
import '../../styles/rare-kit.css'
import { cn } from './cn'

const FACES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
// the trailing 0 makes the wrap from 9 back to 0 land on an identical face
const WHEEL = [...FACES, 0]

const EASE = [0.22, 1, 0.36, 1]
const BOUNCE = 0.18
const LEAVE = { duration: 0.18, ease: EASE }
const INSTANT = { duration: 0 }
const MIN_DURATION = 0.01
const MAX_DURATION = 60

const mod = (n, m) => ((n % m) + m) % m
const clamp = (n, low, high) => Math.min(high, Math.max(low, Number.isFinite(n) ? n : low))
const spring = (duration) => ({ type: 'spring', visualDuration: duration, bounce: BOUNCE })

// Built once so React skips reconciling the sizer and the wheel on every change.
// The sizer sets the width of a digit column to its widest face, for fonts without tabular figures.
const SIZER = FACES.map((face) => (
  <span key={face} aria-hidden className="invisible flex h-(--counter-line) items-center justify-center [grid-area:1/1]">
    {face}
  </span>
))

const STACK = WHEEL.map((face, index) => (
  <span key={index} className="flex h-(--counter-line) items-center justify-center">
    {face}
  </span>
))

// Rolls the wheel to `digit`. It turns forward or back by the shorter way round, following the direction of the value.
function useWheel(from, digit, dir, duration, reduced) {
  const pos = useMotionValue(from)
  const goal = useRef(from)

  // read rather than depended on: a reversal alone must not restart every column
  const heading = useRef(dir)
  useEffect(() => {
    heading.current = dir
  }, [dir])

  useEffect(() => {
    if (reduced) {
      goal.current = digit
      pos.set(digit)
      return
    }
    // re-aim only when the face changed, or a reversal sends the wheel the long way round
    if (mod(goal.current, 10) !== digit) {
      // aim from where the wheel is, so a moving value never queues up a backlog of turns
      const at = pos.get()
      goal.current = heading.current < 0 ? at - mod(at - digit, 10) : at + mod(digit - at, 10)
    }
    const roll = animate(pos, goal.current, spring(duration))
    return () => roll.stop()
  }, [digit, duration, reduced, pos])

  return useTransform(pos, (p) => `${(-mod(p, 10) * 100) / WHEEL.length}%`)
}

const shifts = ({ reduced, dep, shift }) => ({
  layout: !reduced,
  layoutDependency: dep,
  transition: shift
})

const fades = (reduced) => ({
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0, transition: reduced ? INSTANT : LEAVE }
})

// One digit column. forwardRef: AnimatePresence (popLayout) measures the leaving column through the ref it passes.
const Digit = memo(
  forwardRef(function Digit({ digit, from, dir, duration, reduced, dep, shift }, ref) {
    const y = useWheel(from, digit, dir, duration, reduced)
    const style = { y }

    return (
      <motion.span
        ref={ref}
        data-slot="animated-counter-digit"
        {...shifts({ reduced, dep, shift })}
        {...fades(reduced)}
        className="relative inline-grid h-(--counter-line) overflow-hidden [mask-image:var(--mask-counter-fade)] [-webkit-mask-image:var(--mask-counter-fade)]"
      >
        {SIZER}
        <motion.span style={style} className="absolute inset-x-(--space-0) top-(--space-0)">
          {STACK}
        </motion.span>
      </motion.span>
    )
  })
)

// `value` is a whole number (a negative or fractional value is shown as its whole, non-negative part).
// `duration` is the roll time in seconds.
export default function AnimatedCounter({ value, duration = 0.6, className, ...props }) {
  const reduced = useReducedMotion() ?? false

  const amount = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0
  const chars = String(amount)
  const pace = clamp(duration, MIN_DURATION, MAX_DURATION)
  // keyed by distance from the right, so gaining a place moves columns rather than remounting them
  const cells = [...chars].map((char, index) => ({ key: chars.length - index, digit: Number(char) }))

  const [previous, setPrevious] = useState(amount)
  const [dir, setDir] = useState(1)
  if (previous !== amount) {
    setDir(amount >= previous ? 1 : -1)
    setPrevious(amount)
  }

  // faces at mount; a place that appears later starts from 0 and rolls in
  const [seed] = useState(() => Object.fromEntries(cells.map((cell) => [cell.key, cell.digit])))

  const shift = useMemo(() => (reduced ? INSTANT : spring(pace)), [reduced, pace])
  const slot = { reduced, dep: chars.length, shift }

  return (
    <span data-slot="animated-counter" className={cn('ui-rare-counter inline-flex items-center tabular-nums', className)} {...props}>
      <span className="sr-only">{chars}</span>
      <span aria-hidden className="inline-flex items-center select-none">
        <AnimatePresence mode="popLayout" initial={false}>
          {cells.map((cell) => (
            <Digit key={cell.key} {...slot} digit={cell.digit} from={seed[cell.key] ?? 0} dir={dir} duration={pace} />
          ))}
        </AnimatePresence>
      </span>
    </span>
  )
}
