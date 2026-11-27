import '@testing-library/jest-dom/vitest'

// The MCP view functions run as page globals (server/mcp/ui/*.js: no imports inside them, so the source text can be
// copied into each view). The renderers and the host functions call the client functions by name; install them all.
import * as client from '../../server/mcp/ui/client.js'
import * as hosts from '../../server/mcp/ui/hosts.js'
import { RENDERERS } from '../../server/mcp/ui/render/index.js'

Object.assign(globalThis, client, hosts, Object.fromEntries(RENDERERS.map((fn) => [fn.name, fn])))
