// The consent page (plain server HTML, no React) and the signed decision that carries the
// validated authorize parameters from the GET page to the POST that approves them.
import { SignJWT, jwtVerify } from 'jose'
import { secretKey } from '../session.js'

const AUDIENCE = 'oauth-consent'
const DECISION_TTL = '10m'

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)
}

/** Headers for the consent page. `formOrigin` is the redirect URI origin: Chrome applies form-action to the redirect after a POST. */
export function consentHeaders(formOrigin) {
  return {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-frame-options': 'DENY',
    'content-security-policy': `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${formOrigin}; frame-ancestors 'none'`
  }
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
button.approve{background:#1d4ed8;color:#fff}button.deny{background:#e5e7eb}`

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>
<style>${STYLE}</style></head><body><main>${body}</main></body></html>`
}

/** The page shown when the request cannot be trusted enough to redirect (unknown client or redirect URI). */
export function errorPage(title, message) {
  return page(title, `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>`)
}

/** The Approve / Deny page. `requestToken` is the signed decision; everything shown is escaped. */
export function consentPage({ clientName, unverified, redirectHost, requestToken }) {
  const warning = unverified
    ? '<p class="warn">This app is not verified. Approve only if you started it yourself.</p>'
    : ''
  return page(
    'Allow access',
    `<h1>Allow ${escapeHtml(clientName)} to use X Thread Draft Tool?</h1>
${warning}
<p>It will be able to read, create, edit, publish, share and delete your drafts.</p>
<p>After you choose, it sends you back to <strong>${escapeHtml(redirectHost)}</strong>.</p>
<form method="post" action="/api/oauth/authorize">
<input type="hidden" name="request" value="${escapeHtml(requestToken)}">
<button class="approve" name="decision" value="approve">Approve</button>
<button class="deny" name="decision" value="deny">Deny</button>
</form>`
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
export async function openDecision(token) {
  if (typeof token !== 'string' || token.length === 0 || token.length > 4096) return null
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'], audience: AUDIENCE })
    return payload
  } catch {
    return null
  }
}
