// The thread view (plan Task 1 step 5, Task 3): one draft as an X thread, read-only. The view is one HTML document
// with one inline script: the client functions from client.js, copied in with toString(), then a starter written as a
// string so the module transform never rewrites its names. The colors are the X variables from server/share/x-css.js.
import * as client from './client.js'
import { X_VARS_DARK, X_VARS_LIGHT } from '../../share/x-css.js'

export const STYLE = `
:root { color-scheme: light; ${X_VARS_LIGHT} }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { color-scheme: dark; ${X_VARS_DARK} } }
:root[data-theme="dark"] { color-scheme: dark; ${X_VARS_DARK} }
:root[data-theme="light"] { color-scheme: light; ${X_VARS_LIGHT} }
html, body { margin: 0; background: var(--x-bg); color: var(--x-fg); font: 15px/1.4 system-ui, -apple-system, sans-serif; overflow-wrap: anywhere; }
main { max-width: 600px; margin: 0 auto; padding: 0 16px; }
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
footer strong { color: #f4212e; }
`

const STARTER = `
(function () {
  var root = document.getElementById('root');
  var shown = false;
  var link = null;
  function open(url) { return link.openLink(url).catch(function () { return null; }); }
  function showResult(result) {
    shown = true;
    if (result.isError) {
      var first = result.content && result.content[0];
      renderError(root, first && first.text ? first.text : 'The tool returned an error.');
      return;
    }
    var thread = threadFrom(result);
    if (thread) renderThread(root, thread, open);
    else renderError(root, 'This view cannot show that result.');
  }
  function applyContext(ctx) {
    if (ctx && (ctx.theme === 'dark' || ctx.theme === 'light')) document.documentElement.dataset.theme = ctx.theme;
  }
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

// Every function the view runs. Each is copied by its source text, so each must use only its own arguments,
// the globals of the page and the other functions in this list (no module-level constants).
// The functions that draw a thread and talk to the host. The drafts view (drafts.js) copies the same list, so the code
// is shared by reference, not written twice.
export const RENDER_FUNCTIONS = [
  client.bridge,
  client.safeUrl,
  client.safeImage,
  client.tweetFrom,
  client.linksIn,
  client.el,
  client.linkButton,
  client.postNode,
  client.underEditorBase,
  client.headerNode,
  client.renderThread,
  client.renderError,
  client.threadFrom
]

const SCRIPT = RENDER_FUNCTIONS.map((fn) => fn.toString()).join('\n') + STARTER

/** The whole view document. */
const THREAD_HTML = `<!doctype html>
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
<script>${SCRIPT}</script>
</body>
</html>
`

export const THREAD_VIEW = {
  name: 'thread',
  title: 'X thread',
  description: 'One draft as an X thread, read-only.',
  html: THREAD_HTML
}
