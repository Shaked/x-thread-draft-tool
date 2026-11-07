// UI check: create a draft and upload one image. Rerunnable against any deployment.
//
// Run from CI (automatic after preview deployments, or manually): see .github/workflows/ui-image-upload.yml.
// It needs XT_CI_TOKEN: a GitHub Actions OIDC identity token, minted by the workflow for this deployment's
// audience. Nothing long-lived is stored: the token lasts about five minutes and is only sent to this origin.
// Without XT_CI_TOKEN the test is skipped.
//
// Teardown: the draft is deleted at the end of the test (even on failure). DELETE /api/drafts/:id also
// removes the draft's uploaded image blobs.

import { expect, test } from '@playwright/test'

const BASE = process.env.XT_BASE_URL ?? 'http://localhost:5173'
const TOKEN = process.env.XT_CI_TOKEN

// A 1x1 PNG, so the test needs no fixture file.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64'
)

test.describe('image upload', () => {
  test.use({ serviceWorkers: 'block' })
  test.setTimeout(120_000)
  test.skip(!TOKEN, 'XT_CI_TOKEN is not set; the CI workflow mints it. Run the workflow instead of this test by hand.')

  test('creates a draft and uploads an image', async ({ page, context }) => {
    const origin = new URL(BASE).origin

    // Send the CI token on same-origin API calls only.
    await context.route(`${origin}/api/**`, (route) =>
      route.continue({
        headers: { ...route.request().headers(), authorization: `Bearer ${TOKEN}` }
      })
    )

    // Diagnostics: log each API request as it is sent, fails or answers (paths only, never headers).
    page.on('request', (r) => { if (r.url().includes('/api/')) console.log(`request ${r.method()} ${new URL(r.url()).pathname}`) })
    page.on('requestfailed', (r) => { if (r.url().includes('/api/')) console.log(`requestfailed ${new URL(r.url()).pathname} ${r.failure()?.errorText}`) })
    page.on('response', (r) => { if (r.url().includes('/api/')) console.log(`response ${new URL(r.url()).pathname} status=${r.status()}`) })

    let draftId: string | null = null
    try {
      // Diagnostics: report how the app's sign-in call answered (never the token).
      const meResponse = page.waitForResponse((r) => r.url().includes('/api/auth/me'), { timeout: 20_000 }).catch(() => null)
      await page.goto(BASE)
      const me = await meResponse
      if (me) {
        // Never wait on the body without a limit: a stalled body would hang the whole test.
        const body = await Promise.race([me.text().catch(() => ''), new Promise((r) => setTimeout(() => r('(body timed out)'), 5000))])
        console.log(`auth/me status=${me.status()} body=${String(body).slice(0, 200)}`)
      }
      else console.log('auth/me: no response seen')
      await page.locator('.new-draft-btn').first().click()
      await expect(page).toHaveURL(/\/draft\//)
      draftId = new URL(page.url()).pathname.split('/').pop() ?? null

      const fileInput = page.locator('input[type="file"][accept="image/*"]').first()
      await fileInput.setInputFiles({ name: 'pixel.png', mimeType: 'image/png', buffer: PNG })

      // The image must actually decode, not just be present in the DOM.
      const img = page.locator('img.carousel-image').first()
      await expect(img).toBeVisible({ timeout: 20_000 })
      await expect
        .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0), { timeout: 20_000 })
        .toBe(true)
      await expect(page.locator('.upload-error')).toHaveCount(0)
    } finally {
      if (draftId) {
        const res = await page.request.delete(new URL(`/api/drafts/${draftId}`, BASE).toString(), {
          headers: { authorization: `Bearer ${TOKEN}` },
          timeout: 20_000
        })
        expect(res.ok(), `cleanup of draft ${draftId} failed with HTTP ${res.status()}`).toBe(true)
      }
    }
  })
})
