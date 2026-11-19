/* global document */
// The share link card (plan Task 6, #187): create_share_link shows its two links, whether each one works once or
// until it expires, and a countdown to the expiry. The token is never shown on its own: it appears only inside the
// two URLs, in the read-only fields. Nothing here loads or sends anything but the host's openLink and the clipboard
// (rule 10), and the link text reaches the page only through input values and text nodes (rule 9).
import { bridge, el, linkButton, safeUrl } from './client.js'
import { STYLE as THREAD_STYLE } from './thread.js'

const SHARE_STYLE = `
main > header h1 { font-size: 20px; font-weight: 800; margin: 0; }
main > p { color: var(--x-muted); font-size: 14px; margin: 8px 0; }
section input { display: block; width: 100%; box-sizing: border-box; margin: 4px 0 8px; font: inherit; font-size: 14px; color: var(--x-fg); background: var(--x-card); border: 1px solid var(--x-line); border-radius: 8px; padding: 8px 10px; }
section div { display: flex; flex-wrap: wrap; gap: 8px; }
button:disabled { opacity: 0.5; cursor: default; }
`

/** The share link in a create_share_link result: both URLs (https only), the expiry (ms, or null) and one_time. Null otherwise. */
export function shareFrom(result) {
  const body = (result && result.structuredContent) || {}
  const preview = safeUrl(body.preview_url, null)
  const markdown = safeUrl(body.markdown_url, null)
  if (!preview || !markdown) return null
  const expires = Date.parse(body.expires_at)
  return { preview: preview, markdown: markdown, expiresAt: isNaN(expires) ? null : expires, oneTime: body.one_time === true }
}

/** The time left as m:ss, or h:mm:ss from an hour up. Called only while the link has not expired. */
export function countdownText(expiresAt, now) {
  const left = Math.max(0, Math.ceil((expiresAt - now) / 1000))
  const pad = (n) => (n < 10 ? '0' + n : String(n))
  const h = Math.floor(left / 3600)
  const m = Math.floor((left % 3600) / 60)
  const s = left % 60
  return h > 0 ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s)
}

/** The local clock time of the expiry, in the host's locale when it has one. */
export function localTime(expiresAt, locale) {
  const when = new Date(expiresAt)
  const options = { hour: '2-digit', minute: '2-digit' }
  try {
    return when.toLocaleTimeString(locale || undefined, options)
  } catch {
    return when.toLocaleTimeString(undefined, options)
  }
}

/** True when the page can write the clipboard (the sandbox and the host allow it); the Copy button is shown only then. */
function canCopy() {
  return typeof navigator !== 'undefined' && Boolean(navigator.clipboard) && typeof navigator.clipboard.writeText === 'function'
}

/** Copies the field's text. When the write fails, the button says "Select and copy" and the field is selected. */
function copyButton(field) {
  const button = el('button', {}, ['Copy'])
  button.addEventListener('click', function () {
    let done
    try {
      done = navigator.clipboard.writeText(field.value)
    } catch (err) {
      done = Promise.reject(err)
    }
    Promise.resolve(done).then(
      function () {
        button.textContent = 'Copied'
      },
      function () {
        button.textContent = 'Select and copy'
        field.focus()
        field.select()
      }
    )
  })
  return button
}

/** One link: its label, a read-only field with the URL (selected on focus), Open, and Copy when the page can copy. */
function linkRow(label, url, ctx, buttons) {
  const field = document.createElement('input')
  field.readOnly = true
  field.value = url
  field.addEventListener('focus', function () {
    field.select()
  })
  const open = linkButton('Open', url, ctx.open)
  const actions = el('div', {}, [open])
  buttons.push(open)
  if (canCopy()) {
    const copy = copyButton(field)
    buttons.push(copy)
    actions.appendChild(copy)
  }
  return el('section', {}, [el('p', {}, [label]), field, actions])
}

/**
 * Shows the card in root and keeps the countdown current. Returns a function that stops the countdown. ctx: { open, now, locale }.
 */
export function renderShare(root, share, ctx) {
  root.textContent = ''
  root.appendChild(el('header', {}, [el('h1', {}, ['Share link'])]))
  const status = el('p', {}, [])
  root.appendChild(status)
  const buttons = []
  root.appendChild(linkRow('Preview link', share.preview, ctx, buttons))
  root.appendChild(linkRow('Markdown link', share.markdown, ctx, buttons))
  const kind = share.oneTime ? 'Works once' : 'Works until it expires'
  if (share.expiresAt === null) {
    status.textContent = kind
    return function () {}
  }
  // Returns true once the link has expired: the card then says so and its buttons stop working.
  const tick = function () {
    const now = ctx.now()
    if (now >= share.expiresAt) {
      status.textContent = kind + ' · Expired'
      buttons.forEach(function (button) {
        button.disabled = true
      })
      return true
    }
    status.textContent = kind + ' · Expires in ' + countdownText(share.expiresAt, now) + ' (' + localTime(share.expiresAt, ctx.locale) + ')'
    return false
  }
  if (tick()) return function () {}
  const timer = setInterval(function () {
    if (tick()) clearInterval(timer)
  }, 1000)
  return function () {
    clearInterval(timer)
  }
}

/** A one-line message in root in place of the card. */
function renderNote(root, message) {
  root.textContent = ''
  root.appendChild(el('p', { dir: 'auto' }, [message]))
}

// Every function the share view runs: the bridge and its helpers from client.js, then the functions above. Each is
// copied by its source text, so each uses only its own arguments, the page globals and the functions in this list.
const SCRIPT = [bridge, safeUrl, el, linkButton, shareFrom, countdownText, localTime, canCopy, copyButton, linkRow, renderShare, renderNote]
  .map((fn) => fn.toString())
  .join('\n')

const STARTER = `
(function () {
  var root = document.getElementById('root');
  var link = null;
  var shown = false;
  var stop = null;
  function open(url) { return link.openLink(url).catch(function () { return null; }); }
  function locale() {
    var ctx = link.context();
    return ctx && typeof ctx.locale === 'string' ? ctx.locale : undefined;
  }
  function showResult(result) {
    shown = true;
    if (stop) { stop(); stop = null; }
    if (result.isError) {
      var first = result.content && result.content[0];
      renderNote(root, first && first.text ? first.text : 'The tool returned an error.');
      return;
    }
    var share = shareFrom(result);
    if (share) stop = renderShare(root, share, { open: open, now: function () { return Date.now(); }, locale: locale() });
    else renderNote(root, 'This view cannot show that result.');
  }
  function applyContext(ctx) {
    if (ctx && (ctx.theme === 'dark' || ctx.theme === 'light')) document.documentElement.dataset.theme = ctx.theme;
  }
  link = bridge({
    result: showResult,
    context: applyContext,
    // A late handshake failure must not replace a card already shown from window.openai.
    error: function () { if (!shown) renderNote(root, 'Could not connect to the host.'); }
  });
  // ChatGPT's older path: when no tool result came, use window.openai.toolOutput if the page has it.
  setTimeout(function () {
    if (!link.delivered() && window.openai && window.openai.toolOutput) {
      showResult({ structuredContent: window.openai.toolOutput, _meta: window.openai.toolResponseMetadata });
    }
  }, 1000);
})();
`

/** The whole view document. */
const SHARE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Share link</title>
<style>${THREAD_STYLE}${SHARE_STYLE}</style>
</head>
<body>
<main id="root"><p>Loading link…</p></main>
<script>${SCRIPT}
${STARTER}</script>
</body>
</html>
`

export const SHARE_VIEW = {
  name: 'share',
  title: 'Share link',
  description: 'The two links of a share link, with when each one stops working. Open or copy them.',
  // The card copies a link, so the view declares clipboard write (the host grants it or not).
  permissions: { clipboardWrite: {} },
  html: SHARE_HTML
}
