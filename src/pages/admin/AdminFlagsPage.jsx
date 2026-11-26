import { useEffect, useState } from 'react'
import Banner from '../../ui/Banner'
import Button from '../../ui/Button'
import SegmentedControl from '../../ui/SegmentedControl'
import Section from '../../ui/Section'
import Skeleton from '../../ui/Skeleton'
import Stack from '../../ui/Stack'
import { useToast } from '../../ui/Toast'
import { adminApi } from '../../utils/api'
import { setKit, setSkin } from '../../utils/skin'

// Rare UI is the default for everyone; this page is the admin's off switch. Other users always get Rare UI (#406).
const LOOKS = [
  { value: 'rare', label: 'Rare UI (everyone)' },
  { value: 'default', label: 'Old look, purple (only you)' }
]

const KITS = [
  { value: 'rare', label: 'Rare UI components (everyone)' },
  { value: 'default', label: 'Old components (only you)' }
]

// The value this account has, else the server's default for the flag (Rare UI).
const valueOf = (flags, name) => {
  const flag = flags.find((item) => item.name === name)
  return flag?.value ?? flag?.default ?? 'rare'
}

// Feature flags of the admin's account (#483), the same as GET and POST /api/admin/flags and the admin_list_flags and
// admin_set_flag tools. The choice is saved on the account and copied to this device, so the look paints before the app loads.
export default function AdminFlagsPage() {
  const [state, setState] = useState({ status: 'loading', flags: [] })
  const [failed, setFailed] = useState('')
  const toast = useToast()

  const load = () =>
    adminApi
      .flags()
      .then((flags) => {
        // The account is the source of truth: another browser or the MCP tool may have changed a flag since this app started.
        setSkin(valueOf(flags, 'look'))
        setKit(valueOf(flags, 'components'))
        setState({ status: 'ready', flags })
      })
      .catch(() => setState({ status: 'error', flags: [] }))

  useEffect(() => {
    load()
  }, [])

  const choose = (name, apply) => (value) => {
    setFailed('')
    adminApi
      .setFlag(name, value)
      .then((flags) => {
        apply(valueOf(flags, name))
        setState({ status: 'ready', flags })
        toast({ message: 'Flag saved.' })
      })
      .catch((err) => setFailed(err.code === 'sign_in_cancelled' ? err.message : `Could not save the flag (${err.message || 'no answer'}). Nothing changed.`))
  }

  if (state.status === 'loading') return <Skeleton variant="card" lines={3} />
  if (state.status === 'error') {
    return (
      <Banner
        tone="danger"
        role="alert"
        actions={
          <Button variant="secondary" size="sm" onClick={() => { setState({ status: 'loading', flags: [] }); load() }}>
            Try again
          </Button>
        }
      >
        Could not load the feature flags.
      </Banner>
    )
  }

  return (
    <Stack gap={8}>
      {failed && <Banner tone="danger" role="alert">{failed}</Banner>}
      <Section title="Look" headingLevel={2} description="Colours, corner radius, shadows and motion for every page and component. Everyone else always sees Rare UI; the purple look is only for your account.">
        <SegmentedControl legend="Look" value={valueOf(state.flags, 'look')} options={LOOKS} onChange={choose('look', setSkin)} />
      </Section>
      <Section title="Components" headingLevel={2} description="The real Rare UI components for the theme choice in the menu, Delete draft in the list, the character count and the toast. Everyone else always sees them; the old components are only for your account. They take the colours of the look above.">
        <Stack gap={4}>
          <SegmentedControl legend="Components" value={valueOf(state.flags, 'components')} options={KITS} onChange={choose('components', setKit)} />
          <Banner tone="info" role="none">
            <p>
              The Rare UI look is inspired by the{' '}
              <a href="https://rareui.com" target="_blank" rel="noreferrer">
                Rare UI
              </a>{' '}
              project, and the Rare UI components are copied from it under its licence (MIT with Commons Clause and
              attribution); this link is the credit. Light, dark and Hebrew right-to-left layouts work with every choice.
            </p>
          </Banner>
        </Stack>
      </Section>
    </Stack>
  )
}
