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
  test.skip(!TOKEN, 'XT_CI_TOKEN is not set; the CI workflow mints it. Run the workflow instead of this test by hand.')

  test('creates a draft and uploads an image', async ({ page, context }) => {
    const origin = new URL(BASE).origin

    // Send the CI token on same-origin API calls only.
    await context.route(`${origin}/api/**`, (route) =>
      route.continue({
        headers: { ...route.request().headers(), authorization: `Bearer ${TOKEN}` }
      })
    )

    let draftId: string | null = null
    try {
      await page.goto(BASE)
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
          headers: { authorization: `Bearer ${TOKEN}` }
        })
        expect(res.ok(), `cleanup of draft ${draftId} failed with HTTP ${res.status()}`).toBe(true)
      }
    }
  })
})
