import { useEffect, useState } from 'react'
import Banner from '../ui/Banner'
import Button from '../ui/Button'
import DescriptionList from '../ui/DescriptionList'
import Inline from '../ui/Inline'
import Page from '../ui/Page'
import PageHeader from '../ui/PageHeader'
import Section from '../ui/Section'
import Skeleton from '../ui/Skeleton'
import Stack from '../ui/Stack'
import { useCurrentUser } from '../utils/currentUser'
import { reloadToNewest } from '../utils/reloadToNewest'
import { formatVersion, localBuildInfo, utcText } from '../utils/version'

// Copies the commit and deploy time, and says whether it worked.
function CopyVersionButton({ info }) {
  const [state, setState] = useState('idle')
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${info?.commit ?? 'unknown'} ${info?.deployed_at ?? 'unknown'}`)
      setState('copied')
    } catch {
      setState('failed')
    }
  }
  const label = state === 'copied' ? 'Copied!' : state === 'failed' ? 'Copy failed' : 'Copy commit and deploy time'
  return (
    <Button variant="secondary" size="sm" onClick={copy}>
      {label}
    </Button>
  )
}

function VersionDetails({ info }) {
  const version = formatVersion(info, new Date())
  return (
    <Stack gap={3}>
      <DescriptionList
        items={[
          { term: 'Commit', value: <code title={info?.commit ?? undefined}>{version.short}</code> },
          {
            term: 'Deployed',
            value: (
              <>
                {version.deployedAt}
                <span> ({utcText(info?.deployed_at)})</span>
                <span> · {version.ago}</span>
              </>
            )
          }
        ]}
      />
      <CopyVersionButton info={info} />
    </Stack>
  )
}

// The build of this page (in the browser) and the server's answer (GET /api/version), side by side.
export default function AboutPage() {
  const user = useCurrentUser()
  const build = localBuildInfo()
  const [server, setServer] = useState({ state: 'loading', info: null })

  useEffect(() => {
    let active = true
    fetch('/api/version', { credentials: 'same-origin' })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((info) => active && setServer({ state: 'ready', info }))
      .catch(() => active && setServer({ state: 'error', info: null }))
    return () => {
      active = false
    }
  }, [])

  const newer = server.state === 'ready' && !!build?.commit && !!server.info?.commit && build.commit !== server.info.commit

  return (
    <Page width="narrow">
      <PageHeader title="About" back={{ to: '/', label: '← Back to drafts' }} />
      <Stack gap={8}>
        <Section title="This app" description="The version of the app that is open in this browser.">
          <VersionDetails info={build} />
        </Section>

        <Section title="Server" description="The version the server runs now.">
          {server.state === 'loading' && <Skeleton variant="text" lines={2} />}
          {server.state === 'error' && (
            <Banner tone="danger" role="alert">
              Could not reach the server
            </Banner>
          )}
          {server.state === 'ready' && <VersionDetails info={server.info} />}
          {newer && (
            <Banner
              tone="info"
              role="status"
              actions={
                <Button variant="primary" size="sm" onClick={() => reloadToNewest()}>
                  Reload
                </Button>
              }
            >
              A newer version is live. Reload to update.
            </Banner>
          )}
        </Section>

        {/* Attribution required by the Rare UI licence (THIRD_PARTY_LICENSES/rare-ui.md): a visible link to rareui.com. */}
        <Section title="Credits">
          <Stack gap={3}>
            <p lang="en" dir="ltr">
              The look and some components come from{' '}
              <a href="https://rareui.com" target="_blank" rel="noreferrer">
                Rare UI (rareui.com)
              </a>
              , used under its licence:{' '}
              <span dir="ltr">MIT + Commons Clause License Condition v1.0 + Attribution, Copyright (c) 2026 Swami Malode</span>.
            </p>
            <p lang="he" dir="rtl">
              המראה וחלק מהרכיבים לקוחים מ-
              <a href="https://rareui.com" target="_blank" rel="noreferrer" dir="ltr" className="about-credit-link">
                Rare UI (rareui.com)
              </a>
              , לפי הרישיון שלו:{' '}
              <span dir="ltr">MIT + Commons Clause License Condition v1.0 + Attribution, Copyright (c) 2026 Swami Malode</span>.
            </p>
          </Stack>
        </Section>

        {user?.admin === true && (
          <Inline>
            <Button variant="secondary" to="/admin/changelog">
              See what changed
            </Button>
          </Inline>
        )}
      </Stack>
    </Page>
  )
}
