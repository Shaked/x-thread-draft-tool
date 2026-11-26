// The drafts list view (plan Task 5, #182): one row per draft from list_drafts. Each row has an "Open in editor" link
// (only under the editor base the result names) and a "View thread" button: that calls get_draft through the host and
// shows the thread with the render functions of thread.js, with "Back to list". Draft text, titles and ids are data
// (rule 9): they reach the page as text nodes and through el()'s fixed attributes. The view makes no request of its
// own (rule 10): it asks the host to call a tool, and the host does that.
import { el, linkButton, tr, underEditorBase } from './client.js'
import { RENDER_FUNCTIONS, STYLE as THREAD_STYLE } from './thread.js'
import { embedOrigin } from './origin.js'
import { minifyCss, pageScript } from './script.js'

const LIST_STYLE = `
main > header h1 { font-size: 20px; font-weight: 800; margin: 0; }
main > ul > li { display: flex; gap: 12px; align-items: flex-start; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--x-line); }
main > ul > li > div:first-child { min-width: 0; flex: 1 1 auto; }
main > ul > li > div:last-child { display: flex; flex-direction: column; gap: 6px; align-items: flex-end; flex: 0 0 auto; }
main > ul > li h2 { font-size: 16px; font-weight: 700; margin: 0 0 4px; overflow-wrap: anywhere; }
main > ul > li p { margin: 0 0 2px; color: var(--x-muted); font-size: 14px; }
main > ul > li strong { color: #f4212e; font-weight: 700; }
main > p { color: var(--x-muted); }
`

const DRAFTS_STYLE = THREAD_STYLE + LIST_STYLE

/** "Published <date>" for a published draft, "Updated <relative time>" otherwise; null when the date is unknown. */
function dateText(draft, locale, now) {
  if (draft.is_published === true) {
    const then = Date.parse(draft.published_at)
    if (isNaN(then)) return tr('drafts', 'published')
    let day
    try {
      day = new Intl.DateTimeFormat(locale || undefined, { dateStyle: 'medium' }).format(new Date(then))
    } catch {
      day = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(then))
    }
    return tr('drafts', 'published_on', { day: day })
  }
  const rel = relativeTime(draft.updated_at, locale, now)
  return rel ? tr('drafts', 'updated', { when: rel }) : null
}

/** A time relative to now ("3 hours ago") in the host's locale; null when iso is not a date. */
export function relativeTime(iso, locale, now) {
  const then = Date.parse(iso)
  if (isNaN(then)) return null
  let rtf
  try {
    rtf = new Intl.RelativeTimeFormat(locale || undefined, { numeric: 'auto' })
  } catch {
    rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  }
  const seconds = Math.round((then - now) / 1000)
  const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit)
  }
  return rtf.format(0, 'second')
}

/** A button that runs onClick (no link, so no host call of its own). */
function actionButton(label, onClick) {
  const button = el('button', {}, [label])
  if (onClick) button.addEventListener('click', onClick)
  return button
}

/** The text of an error result (or a fixed sentence when it has none). */
export function errorText(result) {
  const first = result && result.content && result.content[0]
  return first && first.text ? first.text : tr('common', 'tool_error')
}

/**
 * One draft row: title (dir auto, "Untitled" when empty), counts (only when the row has them: detail full rows do not),
 * the over-limit chip, the date, then the actions. ctx: { editorBase, open, view, locale, now }.
 */
export function draftRow(draft, ctx) {
  const count = (value) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0)
  const plural = (n, word) => tr('drafts', word + (n === 1 ? '_one' : '_many'), { n: n })
  const id = typeof draft.id === 'string' && draft.id !== '' ? draft.id : null
  const title = typeof draft.title === 'string' && draft.title.trim() !== '' ? draft.title : tr('drafts', 'untitled')
  const left = [el('h2', { dir: 'auto' }, [title])]
  if (typeof draft.post_count === 'number') {
    const parts = [plural(count(draft.post_count), 'post'), plural(count(draft.total_chars), 'character')]
    if (count(draft.image_count) > 0) parts.push(plural(count(draft.image_count), 'image'))
    left.push(el('p', {}, [parts.join(' · ')]))
  }
  if (count(draft.over_limit_count) > 0) left.push(el('p', {}, [el('strong', {}, [tr('drafts', 'over', { n: count(draft.over_limit_count) })])]))
  const date = dateText(draft, ctx.locale, ctx.now)
  if (date) left.push(el('p', {}, [date]))
  const actions = []
  const url = id && ctx.editorBase ? ctx.editorBase + encodeURIComponent(id) : null
  if (url && underEditorBase(url, ctx.editorBase)) actions.push(linkButton(tr('drafts', 'open_editor'), url, ctx.open))
  if (id) actions.push(actionButton(tr('drafts', 'view_thread'), () => ctx.view(id)))
  return el('li', {}, [el('div', {}, left), el('div', {}, actions)])
}

/** Shows the list in root: a heading, then one row per draft, or "No drafts yet". */
export function renderList(root, list, ctx) {
  root.textContent = ''
  root.appendChild(el('header', {}, [el('h1', {}, [tr('drafts', 'title')])]))
  if (list.drafts.length === 0) {
    root.appendChild(el('p', {}, [tr('drafts', 'empty')]))
    return
  }
  root.appendChild(el('ul', {}, list.drafts.map((draft) => draftRow(draft, { ...ctx, editorBase: list.editorBase }))))
}

/** The drafts in a list_drafts result, with the editor base from _meta; null for anything else. */
export function listFrom(result) {
  const structured = (result && result.structuredContent) || {}
  const meta = (result && result._meta) || {}
  if (!Array.isArray(structured.drafts)) return null
  return {
    drafts: structured.drafts.filter((draft) => draft && typeof draft === 'object'),
    editorBase: typeof meta['x-thread/editorBase'] === 'string' ? meta['x-thread/editorBase'] : null
  }
}

// Every function the drafts view runs: the thread functions (shared, not copied) and the list functions above.
const SCRIPT_FUNCTIONS = [...RENDER_FUNCTIONS, dateText, relativeTime, actionButton, errorText, draftRow, renderList, listFrom]

const STARTER = `
(function () {
  var root = document.getElementById('root');
  var link = null;
  var list = null;
  var shown = false;
  // The image host, baked in by the server (T10 part 3, #238). Images use it before the tool result's _meta.
  var IMAGE_ORIGIN = __IMAGE_ORIGIN__;
  function open(url) { return link.openLink(url).catch(function () { return null; }); }
  function hostLocale() {
    var ctx = link.context();
    return ctx && typeof ctx.locale === 'string' ? ctx.locale : undefined;
  }
  function locale() { return hostLocale() || (document.documentElement.lang === 'he' ? 'he' : undefined); }
  function useLang(sample) { setLang(hostLocale(), sample); }
  function showList() {
    renderList(root, list, { open: open, view: viewThread, locale: locale(), now: Date.now() });
  }
  function viewThread(id) {
    root.textContent = '';
    root.appendChild(actionButton(tr('drafts', 'back'), showList));
    var holder = el('div', {}, [el('p', {}, [tr('drafts', 'loading_thread')])]);
    root.appendChild(holder);
    link.callTool('get_draft', { id: id }).then(function (result) {
      if (result.isError) { renderError(holder, errorText(result)); return; }
      var thread = threadFrom(result);
      if (thread) { thread.imageOrigin = IMAGE_ORIGIN || thread.imageOrigin; renderThread(holder, thread, open); }
      else renderError(holder, tr('drafts', 'cannot_show_draft'));
    }, function () {
      renderError(holder, tr('drafts', 'load_failed'));
    });
  }
  function showResult(result) {
    shown = true;
    if (result.isError) { useLang(''); renderError(root, errorText(result)); return; }
    list = listFrom(result);
    useLang(list ? list.drafts.map(function (draft) { return draft.title; }).join(' ') : '');
    if (list) showList();
    else renderError(root, tr('common', 'cannot_show'));
  }
  function applyContext(ctx) {
    if (ctx && (ctx.theme === 'dark' || ctx.theme === 'light')) document.documentElement.dataset.theme = ctx.theme;
  }
  link = bridge({
    result: showResult,
    context: applyContext,
    // A late handshake failure must not replace a list already shown from window.openai.
    error: function () { if (!shown) { useLang(''); renderError(root, tr('common', 'no_host')); } }
  });
  // ChatGPT's older path: when no tool result came, use window.openai.toolOutput if the page has it.
  setTimeout(function () {
    if (!link.delivered() && window.openai && window.openai.toolOutput) {
      showResult({ structuredContent: window.openai.toolOutput, _meta: window.openai.toolResponseMetadata });
    }
  }, 1000);
})();
`

/** The whole view document, for one image origin (null when the environment has none). */
function draftsHtml(imageOrigin) {
  const script = pageScript(['common', 'thread', 'drafts'], SCRIPT_FUNCTIONS, STARTER.replace('__IMAGE_ORIGIN__', embedOrigin(imageOrigin)))
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Your drafts</title>
<style>${minifyCss(DRAFTS_STYLE)}</style>
</head>
<body>
<main id="root"><p>Loading drafts…</p></main>
<script>${script}</script>
</body>
</html>
`
}

export const DRAFTS_VIEW = {
  name: 'drafts',
  title: 'Your drafts',
  description: 'Your drafts as a list: open in the editor, or view a thread.',
  html: draftsHtml
}
