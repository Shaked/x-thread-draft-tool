#!/usr/bin/env node
// Gets an API token through GitHub's device flow and stores it in .xt-token (mode 600).
//
//   node scripts/agent-login.mjs --base https://x-thread-draft-tool-preview.vercel.app --name "Claude agent"
//
// Prints the code to enter on GitHub, polls until the human approves, and never prints the token.
import { writeFile } from 'node:fs/promises'

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

async function post(path, body) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  const data = await response.json().catch(() => ({}))
  return { status: response.status, data }
}

const started = await post('/api/auth/device/start', {})
if (started.status !== 200) {
  console.error(`Could not start device sign-in (HTTP ${started.status}).`)
  process.exit(1)
}
const { device_code: deviceCode, user_code: userCode, verification_uri: verifyUrl, interval, expires_in: expiresIn } = started.data

console.log(`Open ${verifyUrl || 'https://github.com/login/device'} and enter: ${userCode}`)

const deadline = Date.now() + (expiresIn ?? 900) * 1000
let waitSeconds = interval ?? 5
while (Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000))
  const polled = await post('/api/auth/device/poll', { device_code: deviceCode, name })

  if (polled.status === 202) {
    waitSeconds = polled.data.interval ?? waitSeconds
    continue
  }
  if (polled.status === 201) {
    await writeFile('.xt-token', polled.data.token + '\n', { mode: 0o600 })
    console.log(`Token saved to .xt-token (prefix ${polled.data.token.slice(0, 10)}…)`)
    process.exit(0)
  }
  console.error(`Sign-in failed: ${polled.data.error || `HTTP ${polled.status}`}`)
  process.exit(1)
}
console.error('The code expired before it was approved. Run the command again.')
process.exit(1)
