#!/usr/bin/env node
// Signs in through GitHub's device flow and saves a 1-hour access token and a refresh token to
// ~/.config/xt/credentials.json (mode 600). `node scripts/xt-token.mjs` then prints a fresh access token.
//
//   node scripts/agent-login.mjs --base https://x-thread-draft-tool-preview.vercel.app --name "Claude agent"
//
// Prints the code to enter on GitHub, polls until the human approves, and never prints a token.
import { CredentialsError, credentialsFile, loginWithDevice } from './agent-credentials.mjs'

function arg(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

const base = (arg('base') || process.env.XT_BASE_URL || '').replace(/\/$/, '')
const name = arg('name') || 'Agent token'
if (!base) {
  console.error('Usage: node scripts/agent-login.mjs --base <url> [--name <token name>]')
  process.exit(1)
}

try {
  const file = credentialsFile()
  await loginWithDevice({ base, name, file })
  console.log(`Signed in. Credentials saved to ${file} (mode 600).`)
} catch (err) {
  console.error(err instanceof CredentialsError ? err.message : `Sign-in failed: ${err.message}`)
  process.exitCode = 1
}
