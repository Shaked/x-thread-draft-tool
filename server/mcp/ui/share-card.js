/* global document */
// The share link card (plan Task 6, #187), used by the share view (share.js) and by the thread view (thread.js, plan
// Task 7, #189). It shows the two links, how long each one works and a countdown. With Task 7 it also has "Stop this
// link" when the host can proxy tool calls: one click asks "Are you sure?", and only "Yes" calls revoke_share_link.
// The functions here have no module-level constants: each one is copied into a view by its source text (see share.js
// and thread.js), so each uses only its own arguments, the page globals and the other functions in these lists.
// The token is held in memory for that one call and never written to the page (rule 9). Nothing is sent except
// through the bridge's callTool (rule 10).
import { el, linkButton, safeUrl } from './client.js'

export const CARD_STYLE = `
section input { display: block; width: 100%; box-sizing: border-box; margin: 4px 0 8px; font: inherit; font-size: 14px; color: var(--x-fg); background: var(--x-card); border: 1px solid var(--x-line); border-radius: 8px; padding: 8px 10px; }
section div { display: flex; flex-wrap: wrap; gap: 8px; }
button:disabled { opacity: 0.5; cursor: default; }
`

/** The share link in a create_share_link result: both URLs (https only), the expiry (ms, or null), one_time, and the token and draft id for the stop action (null unless UUIDs). Null otherwise. */
export function shareFrom(result) {
  const body = (result && result.structuredContent) || {}
  const preview = safeUrl(body.preview_url, null)
  const markdown = safeUrl(body.markdown_url, null)
  if (!preview || !markdown) return null
  const expires = Date.parse(body.expires_at)
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const token = typeof body.token === 'string' && uuid.test(body.token) ? body.token : null
  const draftId = typeof body.draft_id === 'string' && uuid.test(body.draft_id) ? body.draft_id : null
  return { preview: preview, markdown: markdown, expiresAt: isNaN(expires) ? null : expires, oneTime: body.one_time === true, token: token, draftId: draftId }
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
 * "Stop this link" (plan Task 7, #189). One click shows "Are you sure?"; only "Yes" calls ctx.revoke(draftId, token),
 * once. While the call is open the note says "Waiting for your OK in the chat" (the host may ask the user first). A
 * stopped link calls finish('Stopped'). Returns the box to add to the card.
 */
function stopControl(share, ctx, note, finish) {
  const stop = el('button', {}, ['Stop this link'])
  const question = el('p', {}, ['Are you sure? The link stops working at once.'])
  const yes = el('button', {}, ['Yes, stop this link'])
  const no = el('button', {}, ['Cancel'])
  const row = el('div', {}, [stop])
  const ask = el('div', {}, [question, yes, no])
  ask.hidden = true
  const box = el('div', {}, [row, ask])
  stop.addEventListener('click', function () {
    row.hidden = true
    ask.hidden = false
  })
  no.addEventListener('click', function () {
    ask.hidden = true
    row.hidden = false
  })
  yes.addEventListener('click', function () {
    yes.disabled = true
    no.disabled = true
    note.textContent = 'Waiting for your OK in the chat'
    let call
    try {
      call = ctx.revoke(share.draftId, share.token)
    } catch (err) {
      call = Promise.reject(err)
    }
    Promise.resolve(call).then(
      function (result) {
        if (result && result.isError) {
          const first = result.content && result.content[0]
          note.textContent = first && first.text ? first.text : 'The link could not be stopped.'
          yes.disabled = false
          no.disabled = false
          ask.hidden = true
          row.hidden = false
          return
        }
        note.textContent = ''
        finish('Stopped')
      },
      function (err) {
        const timedOut = /timed out$/.test(String(err && err.message))
        note.textContent = timedOut ? 'No answer from the host. Try again.' : 'Your app does not allow this here.'
        if (timedOut) {
          yes.disabled = false
          no.disabled = false
          ask.hidden = true
          row.hidden = false
        } else {
          box.remove()
        }
      }
    )
  })
  return box
}

/**
 * Shows the card in root and keeps the countdown current. Returns a function that stops the countdown. ctx: { open, now,
 * locale, revoke }. revoke is set only when the host can call tools; the stop action shows only then, and only for a
 * link with both ids.
 */
export function renderShare(root, share, ctx) {
  root.textContent = ''
  root.appendChild(el('header', {}, [el('h1', {}, ['Share link'])]))
  const status = el('p', {}, [])
  const note = el('p', { dir: 'auto' }, [])
  root.appendChild(status)
  root.appendChild(note)
  const buttons = []
  root.appendChild(linkRow('Preview link', share.preview, ctx, buttons))
  root.appendChild(linkRow('Markdown link', share.markdown, ctx, buttons))
  const kind = share.oneTime ? 'Works once' : 'Works until it expires'
  let timer = null
  let stopBox = null
  const finish = function (text) {
    if (timer) clearInterval(timer)
    status.textContent = text
    buttons.forEach(function (button) {
      button.disabled = true
    })
    if (stopBox) stopBox.remove()
    stopBox = null
  }
  if (typeof ctx.revoke === 'function' && share.draftId && share.token) {
    stopBox = stopControl(share, ctx, note, finish)
    root.appendChild(stopBox)
  }
  if (share.expiresAt === null) {
    status.textContent = kind
    return function () {}
  }
  const tick = function () {
    const now = ctx.now()
    if (now >= share.expiresAt) {
      finish(kind + ' · Expired')
      return true
    }
    status.textContent = kind + ' · Expires in ' + countdownText(share.expiresAt, now) + ' (' + localTime(share.expiresAt, ctx.locale) + ')'
    return false
  }
  if (!tick()) {
    timer = setInterval(function () {
      if (tick()) clearInterval(timer)
    }, 1000)
  }
  return function () {
    if (timer) clearInterval(timer)
  }
}

/** The functions the card runs (shared by the share view and the thread view, copied by source text). */
export const CARD_FUNCTIONS = [shareFrom, countdownText, localTime, canCopy, copyButton, linkRow, stopControl, renderShare]
