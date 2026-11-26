import { useState } from 'react'
import Banner from '../ui/Banner'
import Page from '../ui/Page'
import PageHeader from '../ui/PageHeader'
import SegmentedControl from '../ui/SegmentedControl'
import Section from '../ui/Section'
import Stack from '../ui/Stack'
import { getKit, getSkin, setKit, setSkin } from '../utils/skin'

const LOOKS = [
  { value: 'default', label: 'Current (purple)' },
  { value: 'rare', label: 'Rare UI (black, orange)' }
]

const KITS = [
  { value: 'default', label: 'Current components' },
  { value: 'rare', label: 'Rare UI components' }
]

// Feature flags: switches that change what this browser shows. They are stored on this device only,
// so you can compare a new look against the current one and decide which to keep.
export default function FlagsPage() {
  const [look, setLook] = useState(getSkin)
  const choose = (next) => setLook(setSkin(next))
  const [kit, setKitChoice] = useState(getKit)
  const chooseKit = (next) => setKitChoice(setKit(next))

  return (
    <Page width="narrow">
      <PageHeader title="Feature flags" back={{ to: '/', label: '← Back to drafts' }} subtitle="Try a new look on this device. Nothing changes for other people." />
      <Stack gap={8}>
        <Section title="Look" description="Colours, corner radius, shadows and motion for every page and component.">
          <Stack gap={4}>
            <SegmentedControl legend="Look" value={look} options={LOOKS} onChange={choose} />
          </Stack>
        </Section>
        <Section title="Components" description="Use the real Rare UI component for the theme choice in the menu. It takes the colours of the look above.">
          <Stack gap={4}>
            <SegmentedControl legend="Components" value={kit} options={KITS} onChange={chooseKit} />
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
    </Page>
  )
}
