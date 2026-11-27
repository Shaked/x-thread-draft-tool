import { lazy, Suspense } from 'react'
import { getKit } from '../utils/skin'
import Button from './Button'
import { useConfirm } from './Dialog'
import LoadBoundary from './LoadBoundary'

// Rare UI's delete button (feature flag "Components", src/utils/skin.js). Its chunk loads only when the flag is on.
const RareDeleteButton = lazy(() => import('./rare/DeleteButton.jsx'))

// A delete action that asks first. `confirm`: { title, body, confirmLabel }; `onConfirm` runs only after a yes.
// It may return a promise; false (or a rejection) means the delete failed, and the Rare button goes back to idle.
// Flag off (default): a danger-quiet Button and the confirm dialog. Flag on: Rare UI's two-step delete button,
// whose panel asks the same question (named by `title`, described by `body`).
export default function DeleteButton({ label, confirm, onConfirm, disabledReason }) {
  const ask = useConfirm()
  const askFirst = async () => {
    if (await ask({ ...confirm, tone: 'danger' })) onConfirm()
  }
  const current = (
    <Button variant="danger-quiet" size="sm" onClick={askFirst} disabledReason={disabledReason}>
      {label}
    </Button>
  )
  if (getKit() !== 'rare' || disabledReason) return current
  return (
    <LoadBoundary fallback={current}>
      <Suspense fallback={current}>
        <RareDeleteButton label={label} question={confirm.title} description={confirm.body} confirmLabel={confirm.confirmLabel} onConfirm={onConfirm} />
      </Suspense>
    </LoadBoundary>
  )
}
