// The caller of an in-process request (plan Task 7.6). The MCP server runs REST handlers
// in-process for tools/call; the caller is set here, never read from network input.
import { AsyncLocalStorage } from 'node:async_hooks'

const store = new AsyncLocalStorage()

/** The caller set by runAs(), or null outside such a call. */
export function currentCaller() {
  return store.getStore() ?? null
}

/** Runs `fn` with `caller` as the identity that session.authenticate returns. */
export function runAs(caller, fn) {
  return store.run(caller, fn)
}
