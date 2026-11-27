import { useState } from 'react'
import { authApi } from '../utils/api'
import Banner from '../ui/Banner'
import Button from '../ui/Button'
import Card from '../ui/Card'
import Icon from '../ui/Icon'
import Inline from '../ui/Inline'
import Page from '../ui/Page'
import PageHeader from '../ui/PageHeader'
import Stack from '../ui/Stack'

// What a visitor gets. Each line has a line icon from src/ui/Icon.
const FEATURES = [
  { icon: 'compose', text: 'Compose multi-tweet threads' },
  { icon: 'image', text: 'Add images and embed tweets' },
  { icon: 'sync', text: 'Auto-save and cloud sync' },
  { icon: 'share', text: 'Share drafts with unique links' },
  { icon: 'export', text: 'Export to JSON or Markdown' }
]

export default function LoginPage({ suspended = false }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleGitHubLogin = () => {
    try {
      setLoading(true)
      setError(null)
      // Redirects to /api/auth/login, which starts the GitHub OAuth flow.
      authApi.login()
    } catch (err) {
      console.error('Login error:', err)
      setError(err.message || 'Failed to login')
      setLoading(false)
    }
  }

  return (
    <Page width="narrow">
      <Stack gap={4}>
        <PageHeader
          title="X Thread Draft Tool"
          subtitle="Compose, manage, and export Twitter/X threads with ease"
          bar={false}
        />
        <Card padding="md">
          <Stack gap={4}>
            <Stack gap={3}>
              {FEATURES.map((feature) => (
                <Inline key={feature.text} gap={3} align="start">
                  <Icon name={feature.icon} />
                  <span>{feature.text}</span>
                </Inline>
              ))}
            </Stack>
            {suspended && <Banner tone="danger" role="alert">This account is suspended.</Banner>}
            <Button
              variant="primary"
              size="lg"
              fullWidth
              loading={loading}
              loadingLabel="Redirecting to GitHub…"
              onClick={handleGitHubLogin}
            >
              Sign in with GitHub
            </Button>
            {error && <Banner tone="danger" role="alert">{error}</Banner>}
          </Stack>
        </Card>
        <Banner tone="info" role="none">
          No sign-up required. Just authenticate with GitHub to start drafting threads.
        </Banner>
      </Stack>
    </Page>
  )
}
