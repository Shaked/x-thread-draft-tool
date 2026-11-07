// UI check: create a draft and upload one image. Rerunnable against any deployment.
//
// Run:
//   XT_BASE_URL=https://<preview-or-prod-url> XT_SESSION=<xt_session cookie value> \
//     npx playwright test tests/e2e/image-upload.spec.ts
//
// XT_SESSION is the value of the xt_session cookie from a signed-in browser (DevTools → Application →
// Cookies). It is a secret: pass it on the command line or in a shell env var, never commit it.
// Without XT_SESSION the test is skipped.
//
// Teardown: the draft is deleted at the end of the test (even on failure). DELETE /api/drafts/:id also
// removes the draft's uploaded image blobs.

import { expect, test } from '@playwright/test'

const BASE = process.env.XT_BASE_URL ?? 'http://localhost:5173'
const SESSION = process.env.XT_SESSION

// A 1x1 PNG, so the test needs no fixture file.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64'
)

test.describe('image upload', () => {
  test.skip(!SESSION, 'Set XT_SESSION to a signed-in xt_session cookie value to run this test')

  test('creates a draft and uploads an image', async ({ page, context }) => {
    const url = new URL(BASE)
    await context.addCookies([
      {
        name: 'xt_session',
        value: SESSION as string,
        domain: url.hostname,
        path: '/',
        httpOnly: true,
        secure: url.protocol === 'https:',
        sameSite: 'Lax'
      }
    ])

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
        const res = await page.request.delete(new URL(`/api/drafts/${draftId}`, BASE).toString())
        expect(res.ok(), `cleanup of draft ${draftId} failed with HTTP ${res.status()}`).toBe(true)
      }
    }
  })
})
