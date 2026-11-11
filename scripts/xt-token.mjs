#!/usr/bin/env node
// Prints a valid access token for the agent scripts, refreshing it first when it has expired.
// The rotated refresh token is saved (see scripts/agent-credentials.mjs). Run agent-login first.
//
//   XT_TOKEN=$(node scripts/xt-token.mjs) npm run smoke
//
// On failure it prints why and what to run, then exits 1.
import { getAccessToken } from './agent-credentials.mjs'

try {
  process.stdout.write(`${await getAccessToken()}\n`)
} catch (err) {
  console.error(err.message.includes('npm run agent:login') ? err.message : `Could not get an access token: ${err.message}. Run npm run agent:login.`)
  process.exitCode = 1
}
