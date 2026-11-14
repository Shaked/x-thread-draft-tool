import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    trace: 'on-first-retry'
  },
  // The required job starts the local API and the built app, so the app-bar spec can sign in and
  // measure the real page. Not started when XT_BASE_URL points at a deployment.
  webServer: process.env.XT_BASE_URL
    ? undefined
    : [
        { command: 'npm run dev:api', port: 8787, reuseExistingServer: !process.env.CI },
        {
          command: 'npm run build && npx vite preview --host 127.0.0.1 --port 4173 --strictPort',
          port: 4173,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000
        }
      ],
  projects: [
    {
      name: 'chromium',
      testIgnore: /screens\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] }
    },
    // Screenshot harness for UI work. Not part of the default run; see `npm run screens`.
    {
      name: 'screens',
      testMatch: /screens\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] }
    }
  ]
})
