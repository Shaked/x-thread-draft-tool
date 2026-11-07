// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { ROUTES } from '../../server/router.js'
import { OPENAPI } from '../../server/openapi.js'
import { openapiDocument } from '../../server/routes/openapi.js'

// Router paths use :id, OpenAPI uses {id}
const toOpenApiPath = (path) => path.replace(/:([A-Za-z]+)/g, '{$1}')

function routerOperations() {
  return new Set(ROUTES.map((route) => `${route.method.toLowerCase()} ${toOpenApiPath(route.path)}`))
}

function documentedOperations() {
  const ops = new Set()
  for (const [path, methods] of Object.entries(OPENAPI.paths)) {
    for (const method of Object.keys(methods)) ops.add(`${method} ${path}`)
  }
  return ops
}

describe('OpenAPI parity', () => {
  it('documents every router route', () => {
    const documented = documentedOperations()
    const missing = [...routerOperations()].filter((op) => !documented.has(op))
    expect(missing).toEqual([])
  })

  it('has no documented operation that the router does not serve', () => {
    const served = routerOperations()
    const stale = [...documentedOperations()].filter((op) => !served.has(op))
    expect(stale).toEqual([])
  })

  it('serves a parseable OpenAPI 3.1 document publicly and cacheably', async () => {
    const res = await openapiDocument()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=300')
    const doc = await res.json()
    expect(doc.openapi).toBe('3.1.0')
    expect(doc.components.securitySchemes.bearerAuth.scheme).toBe('bearer')
  })
})
