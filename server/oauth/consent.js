// The consent page (plain server HTML, no React) and the signed decision that carries the
// validated authorize parameters from the GET page to the POST that approves them.
import { createHash } from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'
import { secretKey } from '../session.js'

const AUDIENCE = 'oauth-consent'
const DECISION_TTL = '10m'

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)
}

// The only script these pages run: it copies the read-only link. Its hash is the only script source
// the policy allows, so the script text must not change without the hash changing with it.
const COPY_SCRIPT = `(function () {
var button = document.getElementById('copy-link')
var field = document.getElementById('share-link')
var note = document.getElementById('copy-note')
if (!button || !field || !note) return
button.addEventListener('click', function () {
field.select()
if (!navigator.clipboard) {
note.textContent = 'Copy is not available here. Select the link and copy it by hand.'
return
}
navigator.clipboard.writeText(field.value).then(function () {
note.textContent = 'Copied.'
}, function () {
note.textContent = 'Copy failed. Select the link and copy it by hand.'
})
})
})()`
const SCRIPT_SOURCE = `'sha256-${createHash('sha256').update(COPY_SCRIPT).digest('base64')}'`

function htmlHeaders(csp) {
  return {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-frame-options': 'DENY',
    'content-security-policy': csp
  }
}

/** Headers for the consent page. `formOrigin` is the redirect URI origin: Chrome applies form-action to the redirect after a POST. */
export function consentHeaders(formOrigin) {
  return htmlHeaders(
    `default-src 'none'; style-src 'unsafe-inline'; script-src ${SCRIPT_SOURCE}; form-action 'self' ${formOrigin}; frame-ancestors 'none'`
  )
}

/** Headers for the sign-in page: the consent page's policy without form-action (it has no form). */
export function signInHeaders() {
  return htmlHeaders(`default-src 'none'; style-src 'unsafe-inline'; script-src ${SCRIPT_SOURCE}; frame-ancestors 'none'`)
}

export function errorHeaders() {
  return {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-frame-options': 'DENY',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'"
  }
}

const STYLE = `body{font-family:system-ui,sans-serif;margin:0;padding:16px;line-height:1.45}
main{max-width:460px;margin:24px auto}h1{font-size:1.25rem}
.warn{border:1px solid #b45309;padding:8px 10px;border-radius:6px}
button{font:inherit;padding:10px 16px;border-radius:6px;border:0;margin-right:8px;cursor:pointer}
button.approve{background:#1d4ed8;color:#fff}button.deny{background:#e5e7eb}
.link-box{margin-top:20px}.link-box p{margin:0 0 8px}.link-box input{width:100%;box-sizing:border-box;font:inherit;padding:8px;border:1px solid #9ca3af;border-radius:6px}
#copy-note{margin-left:8px}
.continue{display:inline-block;padding:10px 16px;border-radius:6px;background:#1d4ed8;color:#fff;text-decoration:none}`

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>
<style>${STYLE}</style></head><body><main>${body}</main></body></html>`
}

/** The page shown when the request cannot be trusted enough to redirect (unknown client or redirect URI). */
export function errorPage(title, message) {
  return page(title, `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>`)
}

/** The read-only link and a Copy link button. Works without scripts: the field can be selected by hand. */
function copyBlock(link, text) {
  return `<section class="link-box">
<p>${escapeHtml(text)}</p>
<input id="share-link" type="text" readonly value="${escapeHtml(link)}">
<button type="button" id="copy-link">Copy link</button><span id="copy-note" role="status"></span>
</section>
<script>${COPY_SCRIPT}</script>`
}

/** The Approve / Deny page. `requestToken` is the signed decision; `link` is this same address. Everything shown is escaped. */
export function consentPage({ clientName, unverified, redirectHost, requestToken, login, link }) {
  const warning = unverified
    ? '<p class="warn">This app is not verified. Approve only if you started it yourself.</p>'
    : ''
  return page(
    'Allow access',
    `<h1>Hi @${escapeHtml(login)}, allow ${escapeHtml(clientName)} to use X Thread Draft Tool?</h1>
${warning}
<p>It will be able to read, create, edit, publish, share and delete your drafts.</p>
<p>After you choose, it sends you back to <strong>${escapeHtml(redirectHost)}</strong>.</p>
<form method="post" action="/api/oauth/authorize">
<input type="hidden" name="request" value="${escapeHtml(requestToken)}">
<button class="approve" name="decision" value="approve">Approve</button>
<button class="deny" name="decision" value="deny">Deny</button>
</form>
${copyBlock(link, `Hi @${login}: click Approve to continue here, or copy this link and open it in another browser.`)}`
  )
}

/** Shown to a signed-out visitor instead of a redirect to GitHub. `loginUrl` is the sign-in address with return_to. */
export function signInPage({ link, loginUrl }) {
  return page(
    'Sign in to continue',
    `<h1>Sign in to continue</h1>
<p><a class="continue" href="${escapeHtml(loginUrl)}">Continue with GitHub</a></p>
${copyBlock(link, 'Wrong browser? Copy this link and open it in the browser where you are signed in.')}`
  )
}

/** Signs the validated parameters and the signed-in user's id (HS256, 10 minutes, audience-bound). */
export function sealDecision(payload) {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(DECISION_TTL)
    .sign(secretKey())
}

/** Returns the decision payload, or null when missing, tampered with, expired or for another audience. */
// Largest token sealDecision can produce: up to four 2048-character fields (client_id, redirect_uri and
// the other accepted parameters), base64url-encoded (4/3) plus the header and claims. Anything longer is
// not from this server.
const MAX_DECISION_TOKEN = 16384

export async function openDecision(token) {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_DECISION_TOKEN) return null
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'], audience: AUDIENCE })
    return payload
  } catch {
    return null
  }
}
