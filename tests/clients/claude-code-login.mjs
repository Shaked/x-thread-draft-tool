// Real Claude Code binary, real OAuth login against the local connector, with no person.
// `claude mcp login --no-browser` prints the authorize URL and waits for a loopback redirect.
// This script makes the same requests a browser would (sign-in with the fake GitHub callback,
// then the consent form), and sends the approved redirect to Claude Code's real listener.
// Exits 0 only if Claude Code exits 0 and prints its explicit success line.
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const PORT = Number(process.env.XT_CLIENT_PORT || 8790)
const BASE = `http://127.0.0.1:${PORT}`
const HOME = mkdtempSync(path.join(tmpdir(), 'xt-claude-home-'))
const env = { ...process.env, HOME, BROWSER: '/bin/true' }
// Claude Code's own success line. A failure prints something else (for example "Authentication failed").
const SUCCESS_LINE = /Authenticated with "x-thread"/

// Throws instead of exiting, so the finally block below always stops the child processes.
function fail(message) {
  throw new Error(message)
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
let login = null
try {
  let ready = false
  for (let i = 0; i < 60 && !ready; i++) {
    ready = await fetch(`${BASE}/api/health`).then((r) => r.ok).catch(() => false)
    if (!ready) await new Promise((r) => setTimeout(r, 1000))
  }
  if (!ready) fail('dev server did not start')

  execFileSync('claude', ['mcp', 'add', '--transport', 'http', 'x-thread', `${BASE}/api/mcp`], { env, stdio: 'pipe' })

  // Claude Code needs a terminal here, so run it under script(1) to get a pseudo-terminal.
  // -e (--return) makes script exit with the child's exit status, so a failed login fails this test.
  login = spawn('script', ['-qefc', 'claude mcp login x-thread --no-browser', '/dev/null'], { env, stdio: ['pipe', 'pipe', 'pipe'] })
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
  })

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

  // 4. The approved redirect goes to Claude Code's own loopback listener.
  const loopback = new URL(approved.location)
  if (loopback.hostname !== 'localhost' && loopback.hostname !== '127.0.0.1') fail(`unexpected return host ${loopback.host}`)
  // Claude Code asks for the redirect URL on its terminal: paste the approved redirect back in.
  login.stdin.write(approved.location + '\n')

  const exitCode = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve('timeout'), 60000)
    login.on('exit', (code) => {
      clearTimeout(timer)
      resolve(code)
    })
  })
  if (exitCode !== 0) fail(`claude mcp login exited with ${exitCode}: ${output.slice(-400)}`)
  if (!SUCCESS_LINE.test(output)) fail(`no success line: ${output.slice(-400)}`)
  console.log('PASS claude-code login: real Claude Code completed OAuth against the local connector')
} catch (err) {
  console.error(`FAIL claude-code login: ${err.message}`)
  process.exitCode = 1
} finally {
  login?.kill()
  server.kill()
}
