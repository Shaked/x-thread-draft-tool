import { useState } from 'react'
import Banner from '../../ui/Banner'
import Dialog from '../../ui/Dialog'
import Field from '../../ui/Field'
import Input from '../../ui/Input'
import Stack from '../../ui/Stack'

// The confirmation of an admin action on one user (#287). It says what will happen, with the user's id, and the
// confirm button stays off until the typed login equals the user's login exactly (the server checks again).
// `children` is extra content (the reason field, the delete counts). `error` is the server's own message.
// Mount it only while it is open, so the typed text starts empty each time.
export default function ConfirmLoginDialog({ title, description, user, confirmLabel, tone = 'danger', busy = false, error, onConfirm, onClose, children }) {
  const [typed, setTyped] = useState('')
  const matches = typed === user.login
  return (
    <Dialog
      open
      onClose={busy ? undefined : onClose}
      dismissible={!busy}
      title={title}
      description={description}
      actions={[
        { label: 'Cancel', variant: 'secondary', onClick: onClose, autoFocus: true, disabled: busy },
        {
          label: confirmLabel,
          variant: tone,
          onClick: () => onConfirm(typed),
          disabledReason: matches ? undefined : 'Type the login exactly',
          loading: busy
        }
      ]}
    >
      <Stack gap={4}>
        {children}
        <Field label={`Type the login (${user.login}) to confirm`}>
          <Input value={typed} onChange={setTyped} dir="ltr" />
        </Field>
        {error && <Banner tone="danger" role="alert">{error}</Banner>}
      </Stack>
    </Dialog>
  )
}
