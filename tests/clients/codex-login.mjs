// Real Codex CLI binary (@openai/codex, pinned), real OAuth login against the local connector, with no person.
// `codex mcp login --no-browser` prints the authorize URL and asks for the callback URL.
// This script makes the same requests a browser would (sign-in with the fake GitHub callback,
// then the consent form), and sends the approved redirect to Claude Code's real listener.
// Exits 0 only if Codex reports a successful login.
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const PORT = Number(process.env.XT_CLIENT_PORT || 8790)
const CODEX = process.env.XT_CODEX || '/tmp/codex-cli/bin/codex'
const BASE = `http://127.0.0.1:${PORT}`
const HOME = mkdtempSync(path.join(tmpdir(), 'xt-codex-home-'))
const env = { ...process.env, CODEX_HOME: path.join(HOME, '.codex'), NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost', BROWSER: '/bin/true' }
mkdirSync(env.CODEX_HOME, { recursive: true })
writeFileSync(path.join(env.CODEX_HOME, 'config.toml'), `mcp_oauth_credentials_store = "file"\n\n[mcp_servers.x-thread]\nurl = "${BASE}/api/mcp"\n`)

function fail(message) {
  console.error(`FAIL codex login: ${message}`)
  process.exit(1)
}

// A cookie jar for one origin: keeps Set-Cookie values and sends them back.
function makeJar() {
  const cookies = new Map()
  return {
    store(res) {
      for (const raw of res.headers.getSetCookie()) {
        const [pair] = raw.split(';')
        const eq = pair.indexOf('=')
        cookies.set(pair.slice(0, eq), pair.slice(eq + 1))
      }
    },
    header() {
      return [...cookies].map(([k, v]) => `${k}=${v}`).join('; ')
    }
  }
}

// One request, following our own redirects (same origin) with the jar. Stops at any other origin.
async function visit(jar, url, init = {}) {
  let current = url
  let method = init.method || 'GET'
  let body = init.body
  for (let hop = 0; hop < 10; hop++) {
    const res = await fetch(current, {
      method,
      body,
      redirect: 'manual',
      headers: { ...(init.headers || {}), cookie: jar.header() }
    })
    jar.store(res)
    const location = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && location) {
      const next = new URL(location, current).toString()
      if (!next.startsWith(BASE)) return { res, location: next }
      current = next
      method = 'GET'
      body = undefined
      continue
    }
    return { res, location: null, text: await res.text() }
  }
  fail('too many redirects')
}

const server = spawn('node', ['scripts/dev-api.mjs', '--fake-github'], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe']
})
if (process.env.XT_DEBUG) { server.stdout.on('data', (d) => process.stderr.write('[server] ' + d)); server.stderr.on('data', (d) => process.stderr.write('[server!] ' + d)) }
try {
  let ready = false
  for (let i = 0; i < 60 && !ready; i++) {
    ready = await fetch(`${BASE}/api/health`).then((r) => r.ok).catch(() => false)
    if (!ready) await new Promise((r) => setTimeout(r, 1000))
  }
  if (!ready) fail('dev server did not start')


  // Codex needs a terminal here, so run it under script(1) to get a pseudo-terminal.
  const login = spawn('script', ['-qfc', `${CODEX} mcp login x-thread --no-browser`, '/dev/null'], { env, stdio: ['pipe', 'pipe', 'pipe'] })
  let output = ''
  login.stdout.on('data', (d) => (output += d))
  login.stderr.on('data', (d) => (output += d))
  const authorizeUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no authorize URL printed')), 30000)
    const check = () => {
      // Claude Code prints the URL twice, the second copy wrapped in colour codes: take the first copy only.
      const esc = String.fromCharCode(27)
      const match = output.match(new RegExp(`http://127\\.0\\.0\\.1:\\d+/api/oauth/authorize\\?[^\\s${esc}]+`))
      if (match) {
        clearTimeout(timer)
        resolve(match[0])
      }
    }
    login.stdout.on('data', check)
    login.stderr.on('data', check)
  }).catch((e) => fail(e.message))

  const jar = makeJar()
  // 1. The authorize page sends us to sign-in; the sign-in step leaves our origin for GitHub.
  const toGithub = await visit(jar, authorizeUrl)
  if (!toGithub.location?.startsWith('https://github.com/login/oauth/authorize')) {
    fail(`expected a GitHub sign-in redirect, got ${toGithub.location ?? toGithub.res.status}; authorize was ${authorizeUrl.replace(/code_challenge=[^&]*&?/, "")}`)
  }
  const state = new URL(toGithub.location).searchParams.get('state')

  // 2. GitHub (faked by the dev server) returns the user to our callback with the state.
  const callback = await visit(jar, `${BASE}/api/auth/callback?code=dev&state=${encodeURIComponent(state)}`)
  if (callback.res.status >= 400) fail(`sign-in callback failed with ${callback.res.status}`)

  // 3. The consent page: read the request token the form carries, then approve.
  const consent = await visit(jar, authorizeUrl.replace('http://127.0.0.1:' + PORT, BASE))
  const requestToken = consent.text?.match(/name="request" value="([^"]+)"/)?.[1]
  if (!requestToken) fail(`no consent form (status ${consent.res.status})`)
  const form = new URLSearchParams({ request: requestToken, decision: 'approve' }).toString()
  const approved = await visit(jar, `${BASE}/api/oauth/authorize`, {
    method: 'POST',
    body: form,
    headers: { 'content-type': 'application/x-www-form-urlencoded' }
  })
  if (!approved.location) fail(`consent did not redirect (status ${approved.res.status})`)

  // 4. The approved redirect is the URL Codex asks for.
  const loopback = new URL(approved.location)
  if (loopback.hostname !== 'localhost' && loopback.hostname !== '127.0.0.1') fail(`unexpected return host ${loopback.host}`)
  // Codex asks for the callback URL on its terminal (hidden input). Wait for that prompt before
  // writing: input sent earlier can be flushed when the prompt starts reading.
  const prompted = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 30000)
    const check = () => {
      if (/Callback URL/.test(output)) {
        clearTimeout(timer)
        resolve(true)
      }
    }
    check()
    login.stdout.on('data', check)
    login.stderr.on('data', check)
  })
  if (!prompted) fail(`codex did not ask for the callback URL: ${output.slice(-400)}`)
  login.stdin.write(approved.location + '\n')

  const exitCode = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve('timeout'), 60000)
    login.on('exit', (code) => {
      clearTimeout(timer)
      resolve(code)
    })
  })
  if (exitCode !== 0) fail(`codex mcp login exited with ${exitCode}: ${output.slice(-400)}`)
  if (!/success|logged in|authenticat/i.test(output)) fail(`no success message: ${output.slice(-400)}`)
  console.log('PASS codex login: real Codex CLI completed OAuth against the local connector')
} finally {
  server.kill()
}
