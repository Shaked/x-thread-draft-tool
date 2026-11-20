/* global window, document, ResizeObserver */
// Browser code for the MCP views (plan Task 1 D1 and D2, Task 3). No imports and no module-level constants:
// index.js and thread.js copy these functions into each view with Function.prototype.toString(), and the unit tests
// call them in jsdom. Draft text reaches the page only through text nodes and a fixed list of attributes (plan
// rule 9). Nothing here loads anything from another host, and nothing here sends data except postMessage (rule 10).

/** The bridge to the host: JSON-RPC 2.0 over postMessage with window.parent. `on` takes the callbacks. */
export function bridge(on) {
  const pending = new Map()
  let nextId = 1
  const state = { hostContext: null, hostCapabilities: {}, delivered: false }

  function post(message) {
    window.parent.postMessage({ jsonrpc: '2.0', ...message }, '*')
  }

  function request(method, params, ms) {
    const id = nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(method + ' timed out'))
      }, ms || 15000)
      pending.set(id, { resolve, reject, timer })
      post({ id, method, params })
    })
  }

  function observeSize() {
    const report = () => {
      post({
        method: 'ui/notifications/size-changed',
        // The body's height follows the content, so a view that shrinks reports a smaller frame too.
        params: { width: Math.ceil(window.innerWidth), height: Math.ceil(document.body.getBoundingClientRect().height) }
      })
    }
    if (typeof ResizeObserver === 'function') new ResizeObserver(report).observe(document.body)
    report()
  }

  function setContext(params) {
    state.hostContext = { ...state.hostContext, ...params }
    if (on.context) on.context(state.hostContext)
  }

  window.addEventListener('message', (event) => {
    // Only the host (the parent frame) is listened to.
    if (event.source !== window.parent) return
    const msg = event.data
    if (!msg || msg.jsonrpc !== '2.0') return
    if (msg.id !== undefined && msg.method === undefined) {
      const waiting = pending.get(msg.id)
      if (!waiting) return
      pending.delete(msg.id)
      clearTimeout(waiting.timer)
      if (msg.error) waiting.reject(new Error(msg.error.message || 'request failed'))
      else waiting.resolve(msg.result)
      return
    }
    if (msg.method === 'ui/notifications/tool-input') {
      if (on.input) on.input(msg.params && msg.params.arguments)
    } else if (msg.method === 'ui/notifications/tool-result') {
      state.delivered = true
      if (on.result) on.result(msg.params || {})
    } else if (msg.method === 'ui/notifications/host-context-changed') {
      setContext(msg.params)
    } else if (msg.method === 'ui/resource-teardown') {
      if (msg.id !== undefined) post({ id: msg.id, result: {} })
      if (on.teardown) on.teardown()
    } else if (msg.id !== undefined) {
      // A request the view does not handle gets a JSON-RPC error, so the host does not wait for a reply.
      post({ id: msg.id, error: { code: -32601, message: 'Method not found: ' + msg.method } })
    }
    // A notification the view does not handle is ignored.
  })

  request('ui/initialize', {
    protocolVersion: '2026-01-26',
    appInfo: { name: 'x-thread-draft-tool', version: '1' },
    appCapabilities: {}
  }).then(
    (result) => {
      setContext((result && result.hostContext) || {})
      state.hostCapabilities = (result && result.hostCapabilities) || {}
      post({ method: 'ui/notifications/initialized', params: {} })
      observeSize()
    },
    (err) => {
      if (on.error) on.error(err)
    }
  )

  return {
    /** Asks the host to open a link. Only https links are sent. */
    openLink(url) {
      const safe = safeUrl(url, null)
      if (!safe) return Promise.reject(new Error('link refused'))
      return request('ui/open-link', { url: safe })
    },
    /**
     * Calls one of the server's tools as the signed-in user, with a 15 s wait unless ms is given. The write actions pass
     * 120000: the host may ask the user first. A view calls a write tool only when canCallTools() is true (plan Task 7).
     */
    callTool(name, args, ms) {
      return request('tools/call', { name, arguments: args || {} }, ms)
    },
    /** True when the host says it can proxy tool calls from the view (hostCapabilities.serverTools). */
    canCallTools() {
      return Boolean(state.hostCapabilities && state.hostCapabilities.serverTools)
    },
    context() {
      return state.hostContext
    },
    delivered() {
      return state.delivered
    }
  }
}

/** The URL when it is https (and, when allowedHosts is a non-empty list, on one of those hosts); else null. */
export function safeUrl(url, allowedHosts) {
  let parsed
  try {
    parsed = new URL(String(url))
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:') return null
  if (Array.isArray(allowedHosts) && allowedHosts.length > 0 && !allowedHosts.includes(parsed.hostname)) return null
  return parsed.href
}

/**
 * An image URL that may load (plan D4): https, and on exactly the one image origin the tool result names (the
 * production Blob store). imageOrigin must look like https://<store>.public.blob.vercel-storage.com or be null.
 */
export function safeImage(url, imageOrigin) {
  if (typeof imageOrigin !== 'string' || !/^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com$/.test(imageOrigin)) {
    return null
  }
  const safe = safeUrl(url, null)
  return safe && new URL(safe).origin === imageOrigin ? safe : null
}

/** A safe-area inset in px: a finite number from 0 to 96, rounded; anything else is null (T10, #238). */
export function clampInset(value) {
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 && n <= 96 ? Math.round(n) : null
}

/** An embedded tweet's link and its "@handle / status id" label; null when the URL is not https. */
export function tweetFrom(url) {
  const safe = safeUrl(url, null)
  if (!safe) return null
  const match = new URL(safe).pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/)
  return { href: safe, label: match ? '@' + match[1] + ' / status ' + match[2] : safe }
}

/** The https links written in a post's text, each once. */
export function linksIn(text) {
  const found = []
  for (const raw of String(text).match(/https?:\/\/[^\s]+/g) || []) {
    // Trailing punctuation goes, but a closing ) or ] stays when the URL opens one of its own (Wikipedia style).
    let url = raw
    while (/[.,;:!?)\]]$/.test(url)) {
      const last = url.slice(-1)
      const open = last === ')' ? '(' : last === ']' ? '[' : null
      if (open && url.split(open).length - 1 >= url.split(last).length - 1) break
      if (!open && !'.,;:!?'.includes(last)) break
      url = url.slice(0, -1)
    }
    const safe = safeUrl(url, null)
    if (safe && !found.includes(safe)) found.push(safe)
  }
  return found
}

/** An element with text children. Only alt, dir, title and href (after the https check) are ever set. */
export function el(tag, attrs, children) {
  const node = document.createElement(tag)
  const allowed = ['href', 'alt', 'dir', 'title']
  for (const name of Object.keys(attrs || {})) {
    if (!allowed.includes(name)) continue
    // A link goes in only after the https check. Images are made by postNode, after safeImage.
    if (name === 'href') {
      const safe = safeUrl(attrs[name], null)
      if (safe) node.setAttribute('href', safe)
    } else {
      node.setAttribute(name, attrs[name])
    }
  }
  for (const child of children || []) {
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child)
  }
  return node
}

/** A button that asks the host to open url (open is the bridge's openLink, which refuses non-https). */
export function linkButton(label, url, open) {
  const button = el('button', {}, [label])
  if (open) button.addEventListener('click', () => open(url))
  return button
}

/** One post as an X-style card: avatar, number, text, links, images, embedded tweet and counter. */
export function postNode(thread, index, total, open) {
  const post = thread.posts[index]
  const text = typeof post === 'string' ? post : String((post && post.text) || '')
  const images = post && Array.isArray(post.images) ? post.images : []
  const tweet = post && typeof post.embeddedTweet === 'string' ? tweetFrom(post.embeddedTweet) : null
  const count = thread.counts ? thread.counts[index] : null
  const initial = Array.from(String(thread.title || '?').trim())[0] || '?'
  const body = el('div', {}, [
    el('header', {}, [el('strong', {}, ['Draft']), el('span', {}, [' ' + (index + 1) + '/' + total])]),
    el('p', { dir: 'auto' }, [text])
  ])
  const links = linksIn(text)
  if (links.length > 0) body.appendChild(el('ul', {}, links.map((url) => el('li', {}, [linkButton(url, url, open)]))))
  if (images.length > 0) {
    const items = []
    images.forEach((img, n) => {
      const url = typeof img === 'string' ? img : img && img.url
      const safe = safeImage(url, thread.imageOrigin)
      if (safe) {
        const pic = document.createElement('img')
        pic.setAttribute('src', safe)
        pic.setAttribute('alt', 'Image ' + (n + 1) + ' of ' + images.length)
        pic.loading = 'lazy'
        items.push(el('li', {}, [pic]))
      } else if (safeUrl(url, null)) {
        items.push(el('li', {}, [linkButton(safeUrl(url, null), safeUrl(url, null), open)]))
      }
    })
    if (items.length > 0) body.appendChild(el('ol', {}, items))
  }
  if (tweet) {
    body.appendChild(
      el('section', {}, [el('p', {}, [tweet.label]), linkButton('Open on X', tweet.href, open)])
    )
  }
  if (count) {
    const over = count.over_limit === true
    const label = count.chars + '/280' + (over ? ' · over by ' + (count.chars - 280) : '')
    body.appendChild(el('footer', {}, [el(over ? 'strong' : 'small', {}, [label])]))
  }
  return el('article', {}, [el('span', {}, [initial]), body])
}

/** True when url is https on the same origin as editorBase and under its path (a prefix on the whole URL is not enough). */
export function underEditorBase(url, editorBase) {
  if (typeof url !== 'string' || typeof editorBase !== 'string') return false
  try {
    const link = new URL(url)
    const base = new URL(editorBase)
    return link.protocol === 'https:' && link.origin === base.origin && link.pathname.startsWith(base.pathname)
  } catch {
    return false
  }
}

/** The thread's heading: title, post count, Published badge, Open in editor (only for links under the app). */
export function headerNode(thread, open) {
  const count = thread.posts.length
  const info = el('p', {}, [count + (count === 1 ? ' post' : ' posts')])
  if (thread.is_published) info.appendChild(el('span', {}, [' · Published']))
  const children = [el('h1', { dir: 'auto' }, [thread.title || 'Untitled draft']), info]
  if (underEditorBase(thread.url, thread.editorBase)) children.push(linkButton('Open in editor', thread.url, open))
  // T10 (#238): only when the starter found a way to go full screen (ChatGPT offers one; the host may still refuse).
  if (typeof thread.expand === 'function') children.push(linkButton('Full screen', null, thread.expand))
  return el('header', {}, children)
}

/** Shows a thread in root: the heading, a banner when it is not saved, then the posts (25 at first). */
export function renderThread(root, thread, open) {
  const total = thread.posts.length
  root.textContent = ''
  root.appendChild(headerNode(thread, open))
  if (!thread.saved) root.appendChild(el('p', { dir: 'auto' }, ['Not saved yet.']))
  if (total === 0) {
    root.appendChild(el('p', {}, ['This draft has no posts.']))
    return
  }
  // T10 (#238): a start line and an end line, so the thread's edges are clear inside a host's card.
  const list = el('div', {}, [el('p', { dir: 'auto' }, ['Start of thread'])])
  root.appendChild(list)
  const first = 25
  const showRange = (from, to) => {
    for (let i = from; i < to; i++) list.appendChild(postNode(thread, i, total, open))
    if (to === total) list.appendChild(el('p', { dir: 'auto' }, ['End of thread']))
  }
  showRange(0, Math.min(total, first))
  if (total > first) {
    const more = linkButton('Show all ' + total + ' posts', null, null)
    more.addEventListener('click', () => {
      more.remove()
      showRange(first, total)
    })
    root.appendChild(more)
  }
}

/** Shows one message in root in place of the thread. */
export function renderError(root, message) {
  root.textContent = ''
  root.appendChild(el('p', { dir: 'auto' }, [message]))
}

/**
 * The thread in a tool result: { draft } from get_draft (saved), or a bare { posts } (not saved, from split_text).
 * The counts come from _meta["x-thread/outline"], the editor base from _meta["x-thread/editorBase"] and the image host
 * from _meta["x-thread/imageOrigin"]; any of them may be missing. The full posts of a create result come from
 * _meta["x-thread/posts"]. Null for anything else.
 */
export function threadFrom(result) {
  const structured = (result && result.structuredContent) || {}
  const meta = (result && result._meta) || {}
  const saved = Boolean(structured.draft)
  const source = structured.draft || structured
  if (!Array.isArray(source.posts)) return null
  const outline = meta['x-thread/outline']
  // The create tools send the outline in structuredContent; the full posts (text, images) come in _meta when they match.
  const full = Array.isArray(meta['x-thread/posts']) && meta['x-thread/posts'].length === source.posts.length ? meta['x-thread/posts'] : null
  return {
    title: source.title,
    posts: full || source.posts,
    saved,
    is_published: source.is_published === true,
    // get_draft puts the editor link in the draft; the create tools put it at the top level of structuredContent.
    url: typeof source.url === 'string' ? source.url : typeof structured.url === 'string' ? structured.url : null,
    counts: outline && Array.isArray(outline.posts) ? outline.posts : null,
    editorBase: typeof meta['x-thread/editorBase'] === 'string' ? meta['x-thread/editorBase'] : null,
    imageOrigin: typeof meta['x-thread/imageOrigin'] === 'string' ? meta['x-thread/imageOrigin'] : null,
    // The draft's id (a UUID), for the share actions of plan Task 7 (#189); null when the result has none.
    id: typeof source.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(source.id) ? source.id : null
  }
}
