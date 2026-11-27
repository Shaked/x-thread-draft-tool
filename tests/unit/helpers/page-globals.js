// The MCP view functions run as page globals (server/mcp/ui/*.js: no imports inside them, so the source text can be
// copied into each view). The renderers and the host functions call the client functions by name; a test that draws a
// view in jsdom imports this file first to install them. (Not in setup.js: that would cost every unit test file.)
import * as client from '../../../server/mcp/ui/client.js'
import * as hosts from '../../../server/mcp/ui/hosts.js'
import { RENDERERS } from '../../../server/mcp/ui/render/index.js'

Object.assign(globalThis, client, hosts, Object.fromEntries(RENDERERS.map((fn) => [fn.name, fn])))
