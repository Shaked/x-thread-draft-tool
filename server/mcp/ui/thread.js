// The thread view (plan Task 1 step 5): one draft as a thread, the title and the text of each post as plain
// paragraphs. Task 3 makes it look like X. The view is one HTML document with one inline script: the client
// functions from client.js, copied in with toString(), then a starter written as a string so the module
// transform never rewrites its names.
import { bridge, el, renderError, renderThread, safeUrl, threadFrom } from './client.js'

const STYLE = `
:root { color-scheme: light dark; --bg: #ffffff; --fg: #0f1419; --muted: #536471; --line: #eff3f4; }
@media (prefers-color-scheme: dark) { :root { --bg: #000000; --fg: #e7e9ea; --muted: #71767b; --line: #2f3336; } }
html, body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.45 system-ui, sans-serif; }
main { padding: 16px; max-width: 600px; margin: 0 auto; }
h1 { font-size: 18px; margin: 0 0 12px; }
article { border-bottom: 1px solid var(--line); padding: 12px 0; }
p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; unicode-bidi: plaintext; }
.status { color: var(--muted); }
`

const STARTER = `
(function () {
  var root = document.getElementById('root');
  function showResult(result) {
    if (result.isError) {
      var first = result.content && result.content[0];
      renderError(root, first && first.text ? first.text : 'The tool returned an error.');
      return;
    }
    var thread = threadFrom(result.structuredContent);
    if (thread) renderThread(root, thread);
    else renderError(root, 'This view cannot show that result.');
  }
  var link = bridge({
    result: showResult,
    error: function () { renderError(root, 'Could not connect to the host.'); }
  });
  // ChatGPT's older path: when no tool result came, use window.openai.toolOutput if the page has it.
  setTimeout(function () {
    if (!link.delivered() && window.openai && window.openai.toolOutput) {
      showResult({ structuredContent: window.openai.toolOutput });
    }
  }, 1000);
})();
`

const SCRIPT = [bridge, el, renderError, renderThread, safeUrl, threadFrom].map((fn) => fn.toString()).join('\n') + STARTER

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
<main id="root"><p class="status">Loading thread…</p></main>
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
