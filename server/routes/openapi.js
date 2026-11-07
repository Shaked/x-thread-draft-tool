import { OPENAPI } from '../openapi.js'

/** GET /api/openapi.json (public, cacheable for five minutes). */
export async function openapiDocument() {
  return new Response(JSON.stringify(OPENAPI), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' }
  })
}

export const openapiRoutes = [{ method: 'GET', path: '/openapi.json', handler: openapiDocument }]
