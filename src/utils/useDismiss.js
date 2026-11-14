import { useEffect } from 'react'

/** While `open` is true, calls setOpen(false) on Escape and on a press outside ref.current. */
export function useDismiss(open, ref, setOpen) {
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onPointer = (event) => {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [open, ref, setOpen])
}
