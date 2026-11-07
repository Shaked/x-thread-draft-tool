import { HttpError, error, json } from './http.js'
import { authRoutes } from './routes/auth.js'
import { deviceRoutes } from './routes/device.js'
import { draftRoutes } from './routes/drafts.js'
import { imageRoutes } from './routes/images.js'
import { shareRoutes } from './routes/share.js'
import { tokenRoutes } from './routes/tokens.js'

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])

function health() {
  return json({ ok: true })
}

export const ROUTES = [
  ...authRoutes,
  ...deviceRoutes,
  ...draftRoutes,
  ...imageRoutes,
  ...shareRoutes,
  ...tokenRoutes,
  { method: 'GET', path: '/health', handler: health }
]

/** Turns `/drafts/:id` into a RegExp plus the ordered list of parameter names. */
function compile(path) {
  const names = []
  const source = path
    .split('/')
    .map((segment) => {
      if (segment.startsWith(':')) {
        names.push(segment.slice(1))
        return '([^/]+)'
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    })
    .join('/')
  return { regex: new RegExp(`^${source}$`), names }
}

const TABLE = ROUTES.map((route) => ({ ...route, ...compile(route.path) }))

/**
 * The path below `/api`. Vercel rewrites every `/api/*` request to `/api/handler?__path=...`,
 * so `__path` wins; direct `/api/...` requests fall back to the pathname.
 */
function routePath(url) {
  const fromRewrite = url.searchParams.get('__path')
  const raw = fromRewrite ?? url.pathname.replace(/^\/api(?=\/|$)/, '')
  return `/${raw.replace(/^\/+|\/+$/g, '')}`
}

/** Refuses state-changing requests whose Origin is not the app (falls back to the request's own origin). */
function checkOrigin(request) {
  const origin = request.headers.get('origin')
  if (!origin) return
  const appOrigin = (process.env.PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, '')
  if (origin !== appOrigin) throw new HttpError(403, 'Cross-origin request blocked')
}

/** Dispatches one request. Always resolves to a Response. */
export async function route(request) {
  try {
    const url = new URL(request.url)
    const path = routePath(url)

    // Only cookie-authenticated writes need the Origin check. A bearer token cannot be attached
    // cross-site without a CORS preflight, and this API sends no CORS allow headers.
    if (MUTATING.has(request.method) && request.headers.get('authorization') === null) {
      checkOrigin(request)
    }

    const candidates = TABLE.filter((entry) => entry.regex.test(path))
    if (candidates.length === 0) return error(404, 'Not found')

    const match = candidates.find((entry) => entry.method === request.method)
    if (!match) return error(405, 'Method not allowed')

    const values = path.match(match.regex).slice(1)
    const params = Object.fromEntries(match.names.map((name, i) => [name, decodeURIComponent(values[i])]))
    return await match.handler({ request, url, path, params })
  } catch (err) {
    if (err instanceof HttpError) return error(err.status, err.message)
    console.error('[api] unhandled error', err)
    return error(500, 'Server error')
  }
}
