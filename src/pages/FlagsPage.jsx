import { useState } from 'react'
import Banner from '../ui/Banner'
import Page from '../ui/Page'
import PageHeader from '../ui/PageHeader'
import SegmentedControl from '../ui/SegmentedControl'
import Section from '../ui/Section'
import Stack from '../ui/Stack'
import { getSkin, setSkin } from '../utils/skin'

const LOOKS = [
  { value: 'default', label: 'Current (purple)' },
  { value: 'rare', label: 'Rare UI (black, orange)' }
]

// Feature flags: switches that change what this browser shows. They are stored on this device only,
// so you can compare a new look against the current one and decide which to keep.
export default function FlagsPage() {
  const [look, setLook] = useState(getSkin)
  const choose = (next) => setLook(setSkin(next))

  return (
    <Page width="narrow">
      <PageHeader title="Feature flags" back={{ to: '/', label: '← Back to drafts' }} subtitle="Try a new look on this device. Nothing changes for other people." />
      <Stack gap={8}>
        <Section title="Look" description="Colours, corner radius, shadows and motion for every page and component.">
          <Stack gap={4}>
            <SegmentedControl legend="Look" value={look} options={LOOKS} onChange={choose} />
            <Banner tone="info" role="none">
              <p>
                No Rare UI code is used. The colours and corners are inspired by the{' '}
                <a href="https://rareui.com" target="_blank" rel="noreferrer">
                  Rare UI
                </a>{' '}
                project, linked here as credit. Light, dark and Hebrew right-to-left layouts work in both looks.
              </p>
            </Banner>
          </Stack>
        </Section>
      </Stack>
    </Page>
  )
}
