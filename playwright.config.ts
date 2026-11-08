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
