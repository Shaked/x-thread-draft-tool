// T10 part 3 (#238): the image origin is baked into the view HTML. These tests pin the rules: one exact Blob origin,
// no value from draft content, and no way for a value to end the script tag.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildUiManifest, uiManifest, uiResourceUri } from '../../server/mcp/ui/index.js'
import { THREAD_VIEW } from '../../server/mcp/ui/thread.js'
import { BLOB_ORIGIN_PATTERN, blobOrigin, embedOrigin, isBlobOrigin } from '../../server/mcp/ui/origin.js'

const GOOD = 'https://abc123.public.blob.vercel-storage.com'

describe('isBlobOrigin and blobOrigin', () => {
  it('accepts only https Blob store origins with a lowercase store id', () => {
    expect(isBlobOrigin(GOOD)).toBe(true)
    for (const bad of [null, '', 'http://abc123.public.blob.vercel-storage.com', 'https://ABC.public.blob.vercel-storage.com',
      'https://abc123.public.blob.vercel-storage.com.evil.test', 'https://*.public.blob.vercel-storage.com',
      'https://abc123.public.blob.vercel-storage.com/path', '</script>']) {
      expect(isBlobOrigin(bad)).toBe(false)
    }
  })

  it('reads the store id from the token and returns null for a malformed token', () => {
    expect(blobOrigin({ BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_abc123_secret' })).toBe(GOOD)
    expect(blobOrigin({ BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_ab/c_x' })).toBeNull()
    expect(blobOrigin({})).toBeNull()
  })
})

describe('embedOrigin', () => {
  it('writes a JSON literal that cannot end a script tag, even for a hostile value (T10 part 3, #238)', () => {
    // The hostile value is escaped as null by isBlobOrigin, so only the escaping itself is checked here.
    const hostile = '</script><script>x()</script>\u2028\u2029&'
    const raw = JSON.stringify(hostile).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
      .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
    expect(raw).not.toMatch(/[<>\u2028\u2029]/)
    expect(JSON.parse(raw)).toBe(hostile)
    expect(embedOrigin(hostile)).toBe('null')
    expect(embedOrigin(GOOD)).toBe(`"${GOOD}"`)
    expect(embedOrigin(null)).toBe('null')
  })
})

describe('the pattern in the view and in the server are the same', () => {
  it('client.js safeImage uses the same regex source as origin.js', () => {
    const client = readFileSync(join(process.cwd(), 'server/mcp/ui/client.js'), 'utf8')
    expect(client).toContain(BLOB_ORIGIN_PATTERN.source)
  })
})

describe('the views carry the origin they were built for', () => {
  it('the thread view HTML has the quoted origin, and a hostile origin gives null with one script end', () => {
    expect(buildUiManifest(GOOD).imageOrigin).toBe(GOOD)
    const html = THREAD_VIEW.html(GOOD)
    expect(html).toContain(`var IMAGE_ORIGIN = "${GOOD}";`)

    const hostileHtml = THREAD_VIEW.html('</script><script>x()</script>')
    expect(hostileHtml).toContain('var IMAGE_ORIGIN = null;')
    expect(hostileHtml.match(/<\/script/g)).toHaveLength(1)
  })

  it('a different origin gives a different thread uri (a cached view never pairs with another origin)', () => {
    const none = buildUiManifest(null).views.find((v) => v.uri.startsWith('ui://x-thread/thread.html')).uri
    const withOrigin = buildUiManifest(GOOD).views.find((v) => v.uri.startsWith('ui://x-thread/thread.html')).uri
    expect(withOrigin).not.toBe(none)
  })

  it('the manifest for this environment equals the manifest built from its own origin', () => {
    expect(uiManifest()).toEqual(buildUiManifest(blobOrigin(process.env)))
    expect(uiResourceUri('thread')).toMatch(/^ui:\/\/x-thread\/thread\.html\?v=[0-9a-f]{12}$/)
  })
})
