// Central metrics plan M1 (#439, task #447): the ops event shape, version 1. Pure functions, no SQL.
// The kinds, names, statuses and attrs keys are the plan's section 3 table. Every limit in the plan is here.
import { SOURCES, findRepo, fullName } from './sources.js'

const EVENT_VERSION = 1
export const MAX_BATCH = 500
const STRING_MAX = 120
const ATTRS_MAX_BYTES = 1024
export const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000
export const MAX_AHEAD_MS = 10 * 60 * 1000
const MAX_MS = 2147483647
const SPEED_STAGES = ['ci', 'merge_wait', 'vercel', 'smoke', 'total']
const DEPLOY_NAMES = ['Production', 'Preview']
const BASE_BRANCHES = ['main']
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/
const ROUTE_TEMPLATE = /^(GET|POST|PUT|PATCH|DELETE) \/[A-Za-z0-9/:._-]*$/

// Rule per "source/kind": name() returns the stored name or null (then the name is "other"),
// status() says whether a status is allowed, attrs lists the only keys kept.
const KIND_RULES = {
  'ci/run': {
    name: (name, repo) => (repo.workflows.includes(name) ? name : null),
    status: (s) => ['success', 'failure', 'timed_out'].includes(s),
    attrs: ['event', 'queue_ms', 'failed_job', 'failed_step', 'pr']
  },
  'git/merge': {
    name: (name) => (BASE_BRANCHES.includes(name) ? name : null),
    status: (s) => s === 'merged',
    attrs: ['pr', 'files', 'docs_only']
  },
  'speed/merge': {
    name: (name) => (SPEED_STAGES.includes(name) ? name : null),
    status: (s) => s === 'ok' || s === 'over',
    attrs: ['limit_ms', 'pr']
  },
  'deploy/deploy': {
    name: (name) => (DEPLOY_NAMES.includes(name) ? name : null),
    status: (s) => s === 'success' || s === 'failure',
    attrs: ['sha']
  },
  'prod/error': {
    name: (name) => (name === 'unmatched' || ROUTE_TEMPLATE.test(name) ? name : null),
    status: (s) => typeof s === 'string' && /^[45]\d\d$/.test(s),
    attrs: ['error', 'code', 'region', 'tool']
  }
}

/** False for NUL bytes and lone surrogates: Postgres refuses both in text and jsonb. */
export function isPlainText(value) {
  return !value.includes('\u0000') && !/[\ud800-\udbff](?![\udc00-\udfff])|(?:^|[^\ud800-\udbff])[\udc00-\udfff]/.test(value)
}

/** Cuts a string to 120 characters (code points, so no character is split). */
export function cut(value) {
  return Array.from(value).slice(0, STRING_MAX).join('')
}

function byteLength(text) {
  return new TextEncoder().encode(text).length
}

/** Keeps only the listed keys, cut strings, numbers and booleans. Refuses an object over 1 KB. */
export function cleanAttrs(raw, keys) {
  const out = {}
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const key of keys) {
      const value = raw[key]
      if (typeof value === 'string') {
        if (!isPlainText(value)) return { error: 'attrs_text' }
        out[key] = cut(value)
      } else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value
      else if (typeof value === 'boolean') out[key] = value
    }
  }
  if (byteLength(JSON.stringify(out)) > ATTRS_MAX_BYTES) return { error: 'attrs_too_big' }
  return { attrs: out }
}

/** A link is kept only when it starts with the repo's own GitHub URL and fits in 120 characters. */
export function cleanLink(link, repoName) {
  if (typeof link !== 'string' || !isPlainText(link)) return null
  const prefix = `https://github.com/${repoName}/`
  if (Array.from(link).length > STRING_MAX) return null
  // Dot segments and encoded dots move a path out of the repo: refuse them before parsing.
  if (/\.\.|%2e|%5c|\\/i.test(link)) return null
  if (!link.startsWith(prefix)) return null
  let url
  try {
    url = new URL(link)
  } catch {
    return null
  }
  return url.origin === 'https://github.com' && url.href.startsWith(prefix) ? link : null
}

/** The "at" time must be within 14 days before and 10 minutes after `now`. Returns the ISO string or null. */
export function parseAt(value, now) {
  if (typeof value !== 'string' || !ISO_TIME.test(value)) return null
  const time = Date.parse(value)
  if (Number.isNaN(time)) return null
  if (time < now - MAX_AGE_MS || time > now + MAX_AHEAD_MS) return null
  return new Date(time).toISOString()
}

function cleanMs(value) {
  if (value === undefined || value === null) return { ms: null }
  if (!Number.isInteger(value) || value < 0 || value > MAX_MS) return { error: 'ms' }
  return { ms: value }
}

/** A name is looked at only when it is a string of at most 120 characters; anything else becomes other. */
function cleanName(value) {
  if (typeof value !== 'string' || Array.from(value).length > STRING_MAX || !isPlainText(value)) return null
  return value
}

/** Checks one event of a batch. Returns { event } for a stored row, or { reason } when refused. */
export function normalizeEvent(raw, { repo, now }) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { reason: 'not_an_object' }
  // Only strings are joined: an object with a broken toString would throw here, not refuse.
  const key = typeof raw.source === 'string' && typeof raw.kind === 'string' ? `${raw.source}/${raw.kind}` : ''
  const rule = Object.hasOwn(KIND_RULES, key) ? KIND_RULES[key] : null
  if (!rule) return { reason: 'unknown_kind' }
  if (typeof raw.id !== 'string' || raw.id === '' || Array.from(raw.id).length > STRING_MAX || !isPlainText(raw.id)) {
    return { reason: 'id' }
  }
  const at = parseAt(raw.at, now)
  if (!at) return { reason: 'at' }
  if (!rule.status(raw.status)) return { reason: 'status' }
  const ms = cleanMs(raw.ms)
  if (ms.error) return { reason: ms.error }
  const attrs = cleanAttrs(raw.attrs, rule.attrs)
  if (attrs.error) return { reason: attrs.error }
  return {
    event: {
      repo_id: repo.repository_id,
      source: raw.source,
      kind: raw.kind,
      id: raw.id,
      at,
      name: rule.name(cleanName(raw.name), repo) ?? 'other',
      status: raw.status,
      ms: ms.ms,
      attrs: attrs.attrs,
      link: cleanLink(raw.link, fullName(repo))
    }
  }
}

/**
 * Checks a whole batch. A batch that is not version 1, names no listed repo or holds more than 500
 * events is refused as a whole. Each event is checked alone: refused ones are listed with their index.
 */
export function validateBatch(body, { sources = SOURCES, now = Date.now() } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, status: 400, reason: 'body' }
  if (body.v !== EVENT_VERSION) return { ok: false, status: 400, reason: 'version' }
  const repo = findRepo(body.repo_id, sources)
  if (!repo) return { ok: false, status: 403, reason: 'repo_not_listed' }
  if (!Array.isArray(body.events)) return { ok: false, status: 400, reason: 'events' }
  if (body.events.length > MAX_BATCH) return { ok: false, status: 413, reason: 'batch_too_large' }
  const events = []
  const refused = []
  body.events.forEach((raw, index) => {
    const result = normalizeEvent(raw, { repo, now })
    if (result.event) events.push(result.event)
    else refused.push({ index, reason: result.reason })
  })
  return { ok: true, repo_id: repo.repository_id, events, refused }
}
