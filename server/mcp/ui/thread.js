// The thread view (plan Task 1 step 5, Task 3): one draft as an X thread, read-only. The view is one HTML document
// with one inline script: the client functions from client.js, copied in with toString(), then a starter written as a
// string so the module transform never rewrites its names. The colors are the X variables from server/share/x-css.js.
import * as client from './client.js'
import { el } from './client.js'
import { X_VARS_DARK, X_VARS_LIGHT } from '../../share/x-css.js'
import { embedOrigin } from './origin.js'
import { CARD_FUNCTIONS, CARD_STYLE, renderShare, shareFrom } from './share-card.js'

export const STYLE = `
:root { color-scheme: light; ${X_VARS_LIGHT} }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { color-scheme: dark; ${X_VARS_DARK} } }
:root[data-theme="dark"] { color-scheme: dark; ${X_VARS_DARK} }
:root[data-theme="light"] { color-scheme: light; ${X_VARS_LIGHT} }
html, body { margin: 0; background: var(--x-bg); color: var(--x-fg); font: 15px/1.4 system-ui, -apple-system, sans-serif; overflow-wrap: anywhere; }
main { max-width: 600px; margin: 0 auto; padding: var(--safe-top, 0px) calc(16px + var(--safe-right, 0px)) var(--safe-bottom, 0px) calc(16px + var(--safe-left, 0px)); }
header { padding: 12px 0; border-bottom: 1px solid var(--x-line); }
h1 { font-size: 20px; font-weight: 800; margin: 0 0 4px; }
header p { margin: 0; color: var(--x-muted); font-size: 14px; }
article { display: grid; grid-template-columns: 40px 1fr; gap: 12px; padding: 12px 0 4px; border-bottom: 1px solid var(--x-line); }
article > span { width: 40px; height: 40px; border-radius: 50%; border: 1px solid var(--x-line); background: var(--x-card); display: flex; align-items: center; justify-content: center; font-weight: 700; color: var(--x-muted); }
article > div { min-width: 0; }
article header { border: 0; padding: 0; display: flex; gap: 4px; align-items: baseline; }
article header strong { font-weight: 700; }
article header span { color: var(--x-muted); }
article p { margin: 4px 0 8px; font-size: 17px; white-space: pre-wrap; unicode-bidi: plaintext; }
article > div > p[dir="auto"] { text-align: start; }
ul, ol { list-style: none; margin: 0 0 8px; padding: 0; }
li { margin: 4px 0; }
ol { display: grid; grid-template-columns: 1fr 1fr; gap: 2px; border-radius: 16px; overflow: hidden; border: 1px solid var(--x-line); }
ol:has(> li:only-child) { grid-template-columns: 1fr; }
li:first-child:nth-last-child(3) { grid-row: span 2; }
ol li { margin: 0; }
ol img { display: block; width: 100%; height: 100%; object-fit: cover; aspect-ratio: 16 / 10; }
ol:has(> li:only-child) img { aspect-ratio: auto; max-height: 420px; object-fit: contain; }
section { border: 1px solid var(--x-line); border-radius: 16px; padding: 10px 12px; margin: 4px 0 8px; }
section p { font-size: 14px; color: var(--x-muted); margin: 0 0 6px; }
button { font: inherit; font-size: 14px; color: var(--x-link); background: none; border: 1px solid var(--x-line); border-radius: 999px; padding: 4px 12px; cursor: pointer; max-width: 100%; overflow-wrap: anywhere; text-align: start; }
footer small { color: var(--x-muted); }
main > div > p { color: var(--x-muted); font-size: 13px; text-align: center; margin: 12px 0; }
footer strong { color: #f4212e; }
${CARD_STYLE}
`

const STARTER = `
(function () {
  var root = document.getElementById('root');
  var shown = false;
  var link = null;
  // The image host, baked in by the server (T10 part 3, #238). Images use it before the tool result's _meta.
  var IMAGE_ORIGIN = __IMAGE_ORIGIN__;
  // T10 (#238): ChatGPT's openExternal when it is there (the MCP Apps guide maps it to openLink); else ui/open-link.
  function open(url) {
    var safe = safeUrl(url, null);
    if (!safe) return Promise.resolve(null);
    if (window.openai && typeof window.openai.openExternal === 'function') {
      try { return Promise.resolve(window.openai.openExternal({ href: safe })).catch(function () { return null; }); } catch (e) { return Promise.resolve(null); }
    }
    return link.openLink(safe).catch(function () { return null; });
  }
  // Full screen only where ChatGPT offers requestDisplayMode; the host may refuse, and that is not an error here.
  function canExpand() { return Boolean(window.openai && typeof window.openai.requestDisplayMode === 'function'); }
  function expand() {
    try { return Promise.resolve(window.openai.requestDisplayMode({ mode: 'fullscreen' })).catch(function () { return null; }); } catch (e) { return Promise.resolve(null); }
  }
  // Create and stop a share link (plan Task 7, #189). The host may ask the user first; the views say so while it waits.
  function createShare(id) { return link.callTool('create_share_link', { id: id }, 120000); }
  function revokeShare(id, token) { return link.callTool('revoke_share_link', { id: id, token: token }, 120000); }
  function showResult(result) {
    shown = true;
    if (result.isError) {
      var first = result.content && result.content[0];
      renderError(root, first && first.text ? first.text : 'The tool returned an error.');
      return;
    }
    var thread = threadFrom(result);
    if (thread) {
      thread.expand = canExpand() ? expand : null;
      thread.imageOrigin = IMAGE_ORIGIN || thread.imageOrigin;
      // Only when the host can call tools from the view (hostCapabilities.serverTools); otherwise no share actions.
      var ctx = link.context();
      thread.share = link.canCallTools() ? { create: createShare, revoke: revokeShare, locale: ctx && typeof ctx.locale === 'string' ? ctx.locale : undefined } : null;
      renderThread(root, thread, open);
      // Plan Task 7 (#189): a saved draft gets "Create share link" right under its heading.
      if (thread.share && thread.id && thread.saved) root.insertBefore(createShareNode(thread, open), root.firstChild.nextSibling);
    } else {
      renderError(root, 'This view cannot show that result.');
    }
  }
  // The host's theme (MCP Apps hostContext, or ChatGPT's window.openai.theme) and its safe-area insets as CSS values.
  function applyContext(ctx) {
    if (!ctx) return;
    if (ctx.theme === 'dark' || ctx.theme === 'light') document.documentElement.dataset.theme = ctx.theme;
    var insets = ctx.safeAreaInsets;
    if (insets) {
      ['top', 'right', 'bottom', 'left'].forEach(function (side) {
        var px = clampInset(insets[side]);
        if (px !== null) document.documentElement.style.setProperty('--safe-' + side, px + 'px');
      });
    }
  }
  // ChatGPT's theme, when its page has one. The key is not checked against OpenAI's docs (unreachable from the build).
  if (window.openai && (window.openai.theme === 'dark' || window.openai.theme === 'light')) applyContext({ theme: window.openai.theme });
  link = bridge({
    result: showResult,
    context: applyContext,
    // A late handshake failure must not replace a thread already shown from window.openai.
    error: function () { if (!shown) renderError(root, 'Could not connect to the host.'); }
  });
  // ChatGPT's older path: when no tool result came, use window.openai.toolOutput if the page has it.
  setTimeout(function () {
    if (!link.delivered() && window.openai && window.openai.toolOutput) {
      showResult({ structuredContent: window.openai.toolOutput, _meta: window.openai.toolResponseMetadata });
    }
  }, 1000);
})();
`

/**
 * "Create share link" (plan Task 7, #189): one click calls create_share_link with the defaults (one use, one hour), then
 * the card (renderShare) is shown in place. A refusal by the host removes the button; a timeout can be tried again.
 */
export function createShareNode(thread, open) {
  const button = el('button', {}, ['Create share link'])
  const note = el('p', { dir: 'auto' }, [])
  const card = el('div', {}, [])
  const box = el('div', {}, [button, note, card])
  button.addEventListener('click', function () {
    button.disabled = true
    note.textContent = 'Waiting for your OK in the chat'
    let call
    try {
      call = thread.share.create(thread.id)
    } catch (err) {
      call = Promise.reject(err)
    }
    Promise.resolve(call).then(
      function (result) {
        const share = result && !result.isError ? shareFrom(result) : null
        if (!share) {
          const first = result && result.content && result.content[0]
          note.textContent = first && first.text ? first.text : 'The link could not be created.'
          button.disabled = false
          return
        }
        note.textContent = ''
        button.remove()
        renderShare(card, share, { open: open, now: function () { return Date.now(); }, locale: thread.share.locale, revoke: thread.share.revoke })
      },
      function (err) {
        const timedOut = /timed out$/.test(String(err && err.message))
        note.textContent = timedOut ? 'No answer from the host. Try again.' : 'Your app does not allow this here.'
        if (timedOut) button.disabled = false
        else button.remove()
      }
    )
  })
  return box
}

// Every function the view runs. Each is copied by its source text, so each must use only its own arguments,
// the globals of the page and the other functions in this list (no module-level constants).
// The functions that draw a thread and talk to the host. The drafts view (drafts.js) copies the same list, so the code
// is shared by reference, not written twice.
export const RENDER_FUNCTIONS = [
  client.bridge,
  client.safeUrl,
  client.safeImage,
  client.clampInset,
  client.tweetFrom,
  client.linksIn,
  client.el,
  client.linkButton,
  client.postText,
  client.postNode,
  client.underEditorBase,
  client.headerNode,
  client.renderThread,
  client.renderError,
  client.threadFrom,
  client.threadSource,
  client.fullPosts,
  client.textThread,
  client.markdownPosts
]

// The page script for one image origin: the render functions, then the starter with the origin baked in.
const scriptFor = (imageOrigin) =>
  [...RENDER_FUNCTIONS, ...CARD_FUNCTIONS, createShareNode].map((fn) => fn.toString()).join('\n') + STARTER.replace('__IMAGE_ORIGIN__', embedOrigin(imageOrigin))

/** The whole view document, for one image origin (null when the environment has none). */
function threadHtml(imageOrigin) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>X thread</title>
<style>${STYLE}</style>
</head>
<body>
<main id="root"><p>Loading thread…</p></main>
<script>${scriptFor(imageOrigin)}</script>
</body>
</html>
`
}

export const THREAD_VIEW = {
  name: 'thread',
  title: 'X thread',
  description: 'One draft as an X thread, read-only.',
  html: threadHtml
}
