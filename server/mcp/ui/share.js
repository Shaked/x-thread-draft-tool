// The share link view (plan Task 6, #187; Task 7, #189): the card from share-card.js in its own page. Nothing here
// loads or sends anything but the host's openLink, the clipboard and, when the host can call tools, the one
// revoke_share_link call the card asks for (rules 9 and 10). The link text reaches the page only through input values
// and text nodes (rule 9).
import { bridge, el, linkButton, safeUrl, setLang, tr } from './client.js'
import { minifyCss, pageScript } from './script.js'
import { CARD_FUNCTIONS } from './share-card.js'
import { STYLE as THREAD_STYLE } from './thread.js'

export { countdownText, localTime, renderShare, shareFrom } from './share-card.js'

const SHARE_STYLE = `
main > header h1 { font-size: 20px; font-weight: 800; margin: 0; }
main > p { color: var(--x-muted); font-size: 14px; margin: 8px 0; }
`

/** A one-line message in root in place of the card. */
function renderNote(root, message) {
  root.textContent = ''
  root.appendChild(el('p', { dir: 'auto' }, [message]))
}

// Every function the share view runs: the bridge and its helpers from client.js, then the card's functions. Each is
// copied by its source text, so each uses only its own arguments, the page globals and the functions in this list.
const FUNCTIONS = [bridge, tr, setLang, safeUrl, el, linkButton, ...CARD_FUNCTIONS, renderNote]

const STARTER = `
(function () {
  var root = document.getElementById('root');
  var link = null;
  var shown = false;
  var stop = null;
  function open(url) { return link.openLink(url).catch(function () { return null; }); }
  // Stops one link (revoke_share_link). The host may ask the user first; the card waits for its answer.
  function revoke(id, token) { return link.callTool('revoke_share_link', { id: id, token: token }, 120000); }
  function hostLocale() {
    var ctx = link.context();
    return ctx && typeof ctx.locale === 'string' ? ctx.locale : undefined;
  }
  function locale() { return hostLocale() || (document.documentElement.lang === 'he' ? 'he' : undefined); }
  // The share result has no draft text, so the language comes from the host's locale, else English.
  function useLang() { setLang(hostLocale(), ''); }
  function showResult(result) {
    shown = true;
    useLang();
    if (stop) { stop(); stop = null; }
    if (result.isError) {
      var first = result.content && result.content[0];
      renderNote(root, first && first.text ? first.text : tr('common', 'tool_error'));
      return;
    }
    var share = shareFrom(result);
    if (share) stop = renderShare(root, share, { open: open, now: function () { return Date.now(); }, locale: locale(), revoke: link.canCallTools() ? revoke : null });
    else renderNote(root, tr('common', 'cannot_show'));
  }
  function applyContext(ctx) {
    if (ctx && (ctx.theme === 'dark' || ctx.theme === 'light')) document.documentElement.dataset.theme = ctx.theme;
  }
  link = bridge({
    result: showResult,
    context: applyContext,
    // A late handshake failure must not replace a card already shown from window.openai.
    error: function () { if (!shown) { useLang(); renderNote(root, tr('common', 'no_host')); } }
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
<style>${minifyCss(THREAD_STYLE + SHARE_STYLE)}</style>
</head>
<body>
<main id="root"><p>Loading link…</p></main>
<script>${pageScript(['common', 'share'], FUNCTIONS, STARTER)}</script>
</body>
</html>
`

export const SHARE_VIEW = {
  name: 'share',
  title: 'Share link',
  description: 'The two links of a share link, with when each one stops working. Open, copy, or stop them.',
  // The card copies a link, so the view declares clipboard write (the host grants it or not).
  permissions: { clipboardWrite: {} },
  html: () => SHARE_HTML
}
