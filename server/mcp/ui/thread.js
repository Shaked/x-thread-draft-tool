// The thread view (plan Task 1 step 5, Task 3): one draft as an X thread, read-only. The view is one HTML document
// with one inline script: the client functions from client.js, copied in with toString(), then a starter written as a
// string so the module transform never rewrites its names. The colors are the X variables from server/share/x-css.js.
import * as client from './client.js'
import { el, tr } from './client.js'
import { HOST_FUNCTIONS } from './hosts.js'
import { RENDERERS } from './render/index.js'
import { X_VARS_DARK, X_VARS_LIGHT } from '../../share/x-css.js'
import { embedOrigin } from './origin.js'
import { minifyCss, pageScript } from './script.js'
import { CARD_FUNCTIONS, CARD_STYLE, renderShare, shareFrom } from './share-card.js'
import { ACCENT_VARS_DARK, ACCENT_VARS_LIGHT } from './tokens.js'

// Spacing (#357), in px, on the 4 px grid of src/styles/tokens.css: heading 16 top, 12 bottom; the action row 8 between
// its buttons and 12 below it; the share card wraps under the row.
export const STYLE = `
:root { color-scheme: light; ${X_VARS_LIGHT}; ${ACCENT_VARS_LIGHT} }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { color-scheme: dark; ${X_VARS_DARK}; ${ACCENT_VARS_DARK} } }
:root[data-theme="dark"] { color-scheme: dark; ${X_VARS_DARK}; ${ACCENT_VARS_DARK} }
:root[data-theme="light"] { color-scheme: light; ${X_VARS_LIGHT}; ${ACCENT_VARS_LIGHT} }
html, body { margin: 0; background: var(--x-bg); color: var(--x-fg); font: 15px/1.4 system-ui, -apple-system, sans-serif; overflow-wrap: anywhere; }
main { max-width: 600px; margin: 0 auto; padding: var(--safe-top, 0px) calc(16px + var(--safe-right, 0px)) var(--safe-bottom, 0px) calc(16px + var(--safe-left, 0px)); }
header { padding: 16px 0 12px; border-bottom: 1px solid var(--x-line); }
h1 { font-size: 20px; font-weight: 800; margin: 0 0 4px; }
header p { margin: 0; color: var(--x-muted); font-size: 14px; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 12px; }
.actions:empty { display: none; }
.share { display: contents; }
.share > p, .share > div { flex-basis: 100%; min-width: 0; margin: 0; }
.share > div { margin-top: 8px; }
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
button { font: inherit; font-size: 14px; color: var(--accent); background: none; border: 1px solid var(--x-line); border-radius: 999px; padding: 4px 12px; cursor: pointer; max-width: 100%; overflow-wrap: anywhere; text-align: start; }
button:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
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
  var IMAGE_ORIGIN = __IMAGE_ORIGIN__;
  function open(url) {
    var safe = safeUrl(url, null);
    if (!safe) return Promise.resolve(null);
    var method = hostMethod(window, 'openLink');
    try { return Promise.resolve(method ? window.openai[method]({ href: safe }) : link.openLink(safe)).catch(function () { return null; }); } catch (e) { return Promise.resolve(null); }
  }
  function canExpand() { return hostMethod(window, 'displayModes') !== null; }
  function expand() {
    try { return Promise.resolve(window.openai[hostMethod(window, 'displayModes')]({ mode: 'fullscreen' })).catch(function () { return null; }); } catch (e) { return Promise.resolve(null); }
  }
  function createShare(id) { return link.callTool('create_share_link', { id: id }, 120000); }
  function revokeShare(id, token) { return link.callTool('revoke_share_link', { id: id, token: token }, 120000); }
  function locale() {
    var ctx = link && link.context();
    return ctx && typeof ctx.locale === 'string' ? ctx.locale : undefined;
  }
  function useLang(sample) { setLang(locale(), sample); }
  function showResult(result) {
    shown = true;
    if (result.isError) {
      useLang('');
      var first = result.content && result.content[0];
      renderError(root, first && first.text ? first.text : tr('common', 'tool_error'));
      return;
    }
    var thread = threadFrom(result);
    if (thread) {
      useLang([thread.title].concat(thread.posts.map(function (post) { return postText(post).text; })).join(' '));
      thread.expand = canExpand() ? expand : null;
      thread.imageOrigin = IMAGE_ORIGIN || thread.imageOrigin;
      thread.share = link.canCallTools() ? { create: createShare, revoke: revokeShare, locale: locale() || (document.documentElement.lang === 'he' ? 'he' : undefined) } : null;
      thread.addImage = thread.share && thread.id && thread.saved ? function (postId) { return addImageNode(link, thread.id, postId); } : null;
      thread.drawn = function () {
        if (!thread.share || !thread.id || !thread.saved) return;
        const share = createShareNode(thread, open);
        share.className = 'share';
        const row = root.querySelector('.actions');
        (row || root).appendChild(share);
      };
      var changes = changesFrom(result);
      if (changes || (result._meta || {})['x-thread/display'] === 'compact') renderChanges(root, thread, changes, open);
      else renderThread(root, thread, open);
      thread.drawn();
    } else {
      useLang('');
      renderError(root, tr('common', 'cannot_show'));
    }
  }
  function applyContext(ctx) {
    var theme = hostTheme(window, ctx);
    if (theme) document.documentElement.dataset.theme = theme;
    var insets = hostInsets(window, ctx);
    for (var side in insets) document.documentElement.style.setProperty('--safe-' + side, insets[side] + 'px');
  }
  applyContext(null);
  link = bridge({
    result: showResult,
    context: applyContext,
    error: function () { if (!shown) { useLang(''); renderError(root, tr('common', 'no_host')); } }
  });
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
  const button = el('button', {}, [tr('share', 'create')])
  const note = el('p', { dir: 'auto' }, [])
  const card = el('div', {}, [])
  const box = el('div', {}, [button, note, card])
  button.addEventListener('click', function () {
    button.disabled = true
    note.textContent = tr('share', 'waiting')
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
          note.textContent = first && first.text ? first.text : tr('share', 'create_failed')
          button.disabled = false
          return
        }
        note.textContent = ''
        button.remove()
        renderShare(card, share, { open: open, now: function () { return Date.now(); }, locale: thread.share.locale, revoke: thread.share.revoke })
      },
      function (err) {
        const timedOut = /timed out$/.test(String(err && err.message))
        note.textContent = timedOut ? tr('share', 'no_answer') : tr('share', 'not_allowed')
        if (timedOut) button.disabled = false
        else button.remove()
      }
    )
  })
  return box
}

/* global createImageBitmap, document */
/**
 * "Add image" under a post with free slots (#420): the chosen file is drawn on a canvas, at most 1600 px wide and 700,000
 * bytes as JPEG, and sent as base64 through the host's add_image_from_url. When the file input, the resize or the call
 * fails (or times out), the host is asked for an upload link (upload_link) and the link is shown as text.
 */
export function addImageNode(link, draftId, postId) {
  const button = el('button', {}, [tr('thread', 'add_image')])
  const note = el('p', { dir: 'auto' }, [])
  const input = document.createElement('input')
  const call = (args) => link.callTool('add_image_from_url', { draftId, postId, ...args }, 120000)
  const fail = () => { note.textContent = tr('common', 'tool_error') }
  const fallback = () => {
    call({ upload_link: true }).then((result) => {
      const found = result.structuredContent && result.structuredContent.upload
      button.remove()
      if (found && !result.isError) note.textContent = tr('thread', 'upload_link') + ' ' + found.link
      else fail()
    }, fail)
  }
  input.type = 'file'
  input.hidden = true
  input.accept = 'image/*'
  input.addEventListener('change', () => {
    button.disabled = true
    createImageBitmap(input.files[0]).then((bitmap) => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      canvas.width = Math.min(1600, bitmap.width)
      canvas.height = Math.round(bitmap.height * canvas.width / bitmap.width) || 1
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const data = canvas.toDataURL('image/jpeg', 0.8).split(',')[1]
      return data.length > 933336 ? Promise.reject() : call({ data, mime: 'image/jpeg' })
    }).then((result) => {
      if (result.isError) return fallback()
      note.textContent = tr('thread', 'image_added')
      button.remove()
    }, fallback)
  })
  button.addEventListener('click', () => {
    try { input.click() } catch { fallback() }
  })
  return el('div', {}, [button, note, input])
}

// Every function the view runs. Each is copied by its source text, so each must use only its own arguments,
// the globals of the page and the other functions in this list (no module-level constants).
// The functions that draw a thread and talk to the host. The drafts view (drafts.js) copies the same list, so the code
// is shared by reference, not written twice.
export const RENDER_FUNCTIONS = [
  client.bridge,
  client.tr,
  client.setLang,
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
  client.changesFrom,
  client.renderChanges,
  client.renderError,
  client.threadFrom,
  client.threadSource,
  client.fullPosts,
  client.textThread,
  client.markdownPosts
]

// The page script for one image origin: the render functions, then the starter with the origin baked in.
const scriptFor = (imageOrigin) =>
  pageScript(['common', 'thread', 'share'], [...RENDER_FUNCTIONS, ...RENDERERS, ...HOST_FUNCTIONS, ...CARD_FUNCTIONS, createShareNode, addImageNode], STARTER.replace('__IMAGE_ORIGIN__', embedOrigin(imageOrigin)))

/** The whole view document, for one image origin (null when the environment has none). */
function threadHtml(imageOrigin) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>X thread</title>
<style>${minifyCss(STYLE)}</style>
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
