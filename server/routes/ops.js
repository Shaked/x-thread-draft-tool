import { HttpError, json, readJson } from '../http.js'
import { opsDailyAudience, opsEventsAudience, verifyOpsToken } from '../oidc-ci.js'
import { ingestBatch } from '../ops/ingest.js'
import { runDailyStep } from '../metrics/daily.js'

// Central metrics plan M2 (#439, task #448) and O5 (#336). Each route checks its own OIDC audience
// (verifyOpsToken), not a `ci: true` route.
const MAX_BODY_BYTES = 2_000_000
const JWT_RE = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/

// The audience each ops path accepts: a token works on one route only.
const OPS_AUDIENCE = new Map([
  ['/ops/events', opsEventsAudience],
  ['/ops/metrics-daily', opsDailyAudience]
])

function bearerToken(request) {
  const match = (request.headers.get('authorization') ?? '').match(JWT_RE)
  return match && match[1].length <= 4096 ? match[1] : null
}

/**
 * The /ops gate (the router calls it before the 405 and the 401 answers). True only for the metrics-daily
 * workflow's token on its own POST path; every other caller gets 404 from the router. Fails closed.
 */
export async function opsPathOpen(request, path) {
  try {
    const audience = request.method === 'POST' ? OPS_AUDIENCE.get(path) : undefined
    const token = bearerToken(request)
    if (!audience || !token) return false
    return (await verifyOpsToken(token, process.env, audience)) !== null
  } catch {
    return false
  }
}

/** POST /api/ops/events: one batch of ops events from metrics-daily.yml. Only that workflow's token passes. */
async function postOpsEvents({ request }) {
  const token = bearerToken(request)
  if (!token || !(await verifyOpsToken(token, process.env, opsEventsAudience))) {
    throw new HttpError(401, 'Invalid or expired API token')
  }
  const body = await readJson(request, MAX_BODY_BYTES)
  return json(await ingestBatch(body))
}

/** POST /api/ops/metrics-daily: the daily step (O5). Same workflow, its own audience. Answers counts only. */
async function postOpsDaily({ request }) {
  const token = bearerToken(request)
  if (!token || !(await verifyOpsToken(token, process.env, opsDailyAudience))) {
    throw new HttpError(401, 'Invalid or expired API token')
  }
  return json(await runDailyStep({ now: Date.now() }))
}

export const opsRoutes = [
  { method: 'POST', path: '/ops/events', handler: postOpsEvents, selfAuth: true },
  { method: 'POST', path: '/ops/metrics-daily', handler: postOpsDaily, selfAuth: true }
]
