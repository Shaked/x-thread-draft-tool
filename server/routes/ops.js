import { HttpError, json, readJson } from '../http.js'
import { verifyOpsToken } from '../oidc-ci.js'
import { ingestBatch } from '../ops/ingest.js'

// Central metrics plan M2 (#439, task #448). Its own OIDC check (verifyOpsToken), not a `ci: true` route.
const MAX_BODY_BYTES = 2_000_000
const JWT_RE = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/

/** POST /api/ops/events: one batch of ops events from metrics-daily.yml. Only that workflow's token passes. */
async function postOpsEvents({ request }) {
  const match = (request.headers.get('authorization') ?? '').match(JWT_RE)
  if (!match || match[1].length > 4096 || !(await verifyOpsToken(match[1]))) {
    throw new HttpError(401, 'Invalid or expired API token')
  }
  const body = await readJson(request, MAX_BODY_BYTES)
  return json(await ingestBatch(body))
}

export const opsRoutes = [{ method: 'POST', path: '/ops/events', handler: postOpsEvents, selfAuth: true }]
