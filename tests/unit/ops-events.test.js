import { describe, expect, it } from 'vitest'
import { cleanAttrs, cleanLink, cut, normalizeEvent, parseAt, validateBatch, MAX_AGE_MS, MAX_AHEAD_MS, MAX_BATCH } from '../../server/ops/events.js'
import { findRepo, fullName, SOURCES } from '../../server/ops/sources.js'

// Central metrics plan M1 (#439, task #447). Every rule of the event shape, version 1.
const NOW = Date.parse('2026-11-25T12:00:00Z')
const REPO = SOURCES[0]
const ok = { v: 1, repo_id: REPO.repository_id, events: [] }
const LINK = `https://github.com/${fullName(REPO)}/actions/runs/1`
const run = (over = {}) => ({
  source: 'ci',
  kind: 'run',
  id: '45713676980.1',
  at: '2026-11-25T11:00:00Z',
  name: 'Tests',
  status: 'success',
  ms: 97000,
  attrs: { event: 'pull_request', queue_ms: 2000 },
  link: LINK,
  ...over
})
const check = (raw) => normalizeEvent(raw, { repo: REPO, now: NOW })

describe('sources list', () => {
  it('lists this repo first, with its numeric id and its workflows', () => {
    expect(SOURCES[0]).toMatchObject({ owner: 'Shaked', name: 'x-thread-draft-tool', repository_id: 1136002672, speed: true })
    expect(SOURCES[0].workflows).toEqual(['Tests', 'Smoke test (deployed)'])
  })

  it('finds a repo only by its numeric id, never by name', () => {
    expect(findRepo(1136002672)).toBe(REPO)
    expect(findRepo('1136002672')).toBeNull()
    expect(findRepo(1)).toBeNull()
  })
})

describe('strings', () => {
  it('cuts to 120 characters and never splits a code point', () => {
    expect(cut('a'.repeat(200))).toHaveLength(120)
    expect(cut('ש'.repeat(121))).toBe('ש'.repeat(120))
    expect(cut('short')).toBe('short')
  })
})

describe('attrs', () => {
  it('keeps only the keys listed for the kind', () => {
    expect(cleanAttrs({ event: 'push', secret: 'x', queue_ms: 5 }, ['event', 'queue_ms'])).toEqual({
      attrs: { event: 'push', queue_ms: 5 }
    })
  })

  it('drops nested values, arrays and non-finite numbers', () => {
    expect(cleanAttrs({ event: { a: 1 }, queue_ms: [1], pr: Infinity, docs_only: true }, ['event', 'queue_ms', 'pr', 'docs_only'])).toEqual({
      attrs: { docs_only: true }
    })
  })

  it('cuts long strings to 120 characters', () => {
    const { attrs } = cleanAttrs({ event: 'e'.repeat(300) }, ['event'])
    expect(attrs.event).toHaveLength(120)
  })

  it('refuses an attrs object over 1 KB', () => {
    // Five keys of 120 Hebrew letters are 5 x 240 bytes in UTF-8, over the 1 KB limit. Three would fit.
    const keys = ['failed_job', 'failed_step', 'event', 'error', 'region']
    const big = Object.fromEntries(keys.map((key) => [key, 'ש'.repeat(120)]))
    expect(cleanAttrs(big, keys)).toEqual({ error: 'attrs_too_big' })
    const three = Object.fromEntries(keys.slice(0, 3).map((key) => [key, 'ש'.repeat(120)]))
    expect(cleanAttrs(three, keys.slice(0, 3))).toHaveProperty('attrs')
  })

  it('treats a missing or non-object attrs as empty', () => {
    expect(cleanAttrs(undefined, ['event'])).toEqual({ attrs: {} })
    expect(cleanAttrs(['x'], ['event'])).toEqual({ attrs: {} })
  })
})

describe('link', () => {
  const name = fullName(REPO)
  it('keeps a link under this repo', () => {
    expect(cleanLink(LINK, name)).toBe(LINK)
  })
  it('drops a link to another repo, another host or a non-string', () => {
    expect(cleanLink('https://github.com/Shaked/other/actions/runs/1', name)).toBeNull()
    expect(cleanLink('https://example.com/Shaked/x-thread-draft-tool/', name)).toBeNull()
    expect(cleanLink(42, name)).toBeNull()
  })
  it('drops a link longer than 120 characters', () => {
    expect(cleanLink(`https://github.com/${name}/${'a'.repeat(120)}`, name)).toBeNull()
  })
})

describe('time window', () => {
  it('accepts a time 14 days ago and 10 minutes ahead', () => {
    expect(parseAt(new Date(NOW - MAX_AGE_MS).toISOString(), NOW)).not.toBeNull()
    expect(parseAt(new Date(NOW + MAX_AHEAD_MS).toISOString(), NOW)).not.toBeNull()
  })
  it('refuses a time older than 14 days or more than 10 minutes ahead', () => {
    expect(parseAt(new Date(NOW - MAX_AGE_MS - 1).toISOString(), NOW)).toBeNull()
    expect(parseAt(new Date(NOW + MAX_AHEAD_MS + 1).toISOString(), NOW)).toBeNull()
  })
  it('refuses a time that is not a date', () => {
    expect(parseAt('soon', NOW)).toBeNull()
    expect(parseAt(undefined, NOW)).toBeNull()
  })
})

describe('event checks', () => {
  it('stores a valid CI run with fixed fields', () => {
    expect(check(run())).toEqual({
      event: {
        repo_id: 1136002672,
        source: 'ci',
        kind: 'run',
        id: '45713676980.1',
        at: '2026-11-25T11:00:00.000Z',
        name: 'Tests',
        status: 'success',
        ms: 97000,
        attrs: { event: 'pull_request', queue_ms: 2000 },
        link: LINK
      }
    })
  })

  it('turns a CI name that is not a listed workflow into other', () => {
    expect(check(run({ name: 'Label notify' })).event.name).toBe('other')
  })

  it('refuses an unknown source or kind', () => {
    expect(check(run({ source: 'log' })).reason).toBe('unknown_kind')
    expect(check(run({ kind: 'job' })).reason).toBe('unknown_kind')
  })

  it('refuses a status that the kind does not allow', () => {
    expect(check(run({ status: 'cancelled' })).reason).toBe('status')
    expect(check(run({ status: undefined })).reason).toBe('status')
  })

  it('refuses an empty id and a bad ms', () => {
    expect(check(run({ id: '' })).reason).toBe('id')
    expect(check(run({ ms: -1 })).reason).toBe('ms')
    expect(check(run({ ms: 1.5 })).reason).toBe('ms')
    expect(check(run({ ms: 2147483648 })).reason).toBe('ms')
  })

  it('accepts a missing ms as null', () => {
    expect(check(run({ ms: undefined })).event.ms).toBeNull()
  })

  it('cuts the id to 120 characters', () => {
    expect(check(run({ id: 'i'.repeat(200) })).event.id).toHaveLength(120)
  })

  it('refuses a non-object event', () => {
    expect(check(null).reason).toBe('not_an_object')
    expect(check(['run']).reason).toBe('not_an_object')
  })

  it('maps a merge base branch and a speed stage to their fixed names', () => {
    expect(check({ source: 'git', kind: 'merge', id: 'abc', at: run().at, name: 'main', status: 'merged', link: LINK }).event.name).toBe('main')
    expect(check({ source: 'git', kind: 'merge', id: 'abc', at: run().at, name: 'feature/x', status: 'merged', link: LINK }).event.name).toBe('other')
    expect(check({ source: 'speed', kind: 'merge', id: 'abc:ci', at: run().at, name: 'ci', status: 'over', ms: 1 }).event.name).toBe('ci')
    expect(check({ source: 'speed', kind: 'merge', id: 'abc:x', at: run().at, name: 'lint', status: 'ok', ms: 1 }).event.name).toBe('other')
  })

  it('accepts only the deploy names Production and Preview', () => {
    const deploy = (name) => check({ source: 'deploy', kind: 'deploy', id: '1', at: run().at, name, status: 'success' })
    expect(deploy('Production').event.name).toBe('Production')
    expect(deploy('Staging').event.name).toBe('other')
  })

  it('keeps a production error route template and turns anything else into other', () => {
    const error = (name, status) => check({ source: 'prod', kind: 'error', id: 'i-1', at: run().at, name, status })
    expect(error('GET /drafts/:id', '500').event.name).toBe('GET /drafts/:id')
    expect(error('unmatched', '404').event.name).toBe('unmatched')
    expect(error('GET /drafts/abc?token=1', '500').event.name).toBe('other')
  })

  it('accepts only a 4xx or 5xx HTTP status for a production error', () => {
    const error = (status) => check({ source: 'prod', kind: 'error', id: 'i-1', at: run().at, name: 'unmatched', status })
    expect(error('503').event.status).toBe('503')
    expect(error('200').reason).toBe('status')
    expect(error(503).reason).toBe('status')
  })

  it('refuses an event whose time is outside the window', () => {
    expect(check(run({ at: '2020-01-01T00:00:00Z' })).reason).toBe('at')
  })
})

describe('batch', () => {
  it('accepts an empty batch from the listed repo', () => {
    expect(validateBatch(ok, { now: NOW })).toEqual({ ok: true, repo_id: 1136002672, events: [], refused: [] })
  })

  it('refuses a batch that is not version 1', () => {
    expect(validateBatch({ ...ok, v: 2 }, { now: NOW })).toMatchObject({ ok: false, status: 400, reason: 'version' })
  })

  it('refuses a batch from a repo that is not listed', () => {
    expect(validateBatch({ ...ok, repo_id: 2 }, { now: NOW })).toMatchObject({ ok: false, status: 403, reason: 'repo_not_listed' })
  })

  it('refuses a batch without an events array', () => {
    expect(validateBatch({ v: 1, repo_id: 1136002672 }, { now: NOW })).toMatchObject({ ok: false, status: 400, reason: 'events' })
  })

  it('accepts 500 events and refuses 501', () => {
    const events = Array.from({ length: MAX_BATCH }, () => run())
    expect(validateBatch({ ...ok, events }, { now: NOW }).events).toHaveLength(MAX_BATCH)
    expect(validateBatch({ ...ok, events: [...events, run()] }, { now: NOW })).toMatchObject({ ok: false, status: 413 })
  })

  it('stores the good events and lists the refused ones by index', () => {
    const result = validateBatch({ ...ok, events: [run(), run({ status: 'cancelled' }), run({ id: 'x' })] }, { now: NOW })
    expect(result.events).toHaveLength(2)
    expect(result.refused).toEqual([{ index: 1, reason: 'status' }])
  })
})
