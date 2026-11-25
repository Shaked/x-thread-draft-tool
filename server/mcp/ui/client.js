/* global window, document, ResizeObserver */
// Browser code for the MCP views (plan Task 1 D1 and D2, Task 3). No imports and no module-level constants:
// index.js and thread.js copy these functions into each view with Function.prototype.toString(), and the unit tests
// call them in jsdom. Draft text reaches the page only through text nodes and a fixed list of attributes (plan
// rule 9). Nothing here loads anything from another host, and nothing here sends data except postMessage (rule 10).

/** The bridge to the host: JSON-RPC 2.0 over postMessage with window.parent. `on` takes the callbacks. */
export function bridge(on) {
  const pending = new Map()
  let nextId = 1
  const state = { hostContext: null, hostCapabilities: {}, delivered: false, sizing: false }

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
    if (state.sizing) return
    state.sizing = true
    const report = () => {
      post({
        method: 'ui/notifications/size-changed',
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
      observeSize()
    } else if (msg.method === 'ui/notifications/host-context-changed') {
      setContext(msg.params)
    } else if (msg.method === 'ui/resource-teardown') {
      if (msg.id !== undefined) post({ id: msg.id, result: {} })
      if (on.teardown) on.teardown()
    } else if (msg.id !== undefined) {
      post({ id: msg.id, error: { code: -32601, message: 'Method not found: ' + msg.method } })
    }
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
      observeSize()
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
  const { text, cut } = postText(post)
  const images = post && Array.isArray(post.images) ? post.images : []
  const tweet = post && typeof post.embeddedTweet === 'string' ? tweetFrom(post.embeddedTweet) : null
  const count = thread.counts ? thread.counts[index] : null
  const initial = Array.from(String(thread.title || '?').trim())[0] || '?'
  const body = el('div', {}, [
    el('header', {}, [el('strong', {}, ['Draft']), el('span', {}, [' ' + (index + 1) + '/' + total])]),
    el('p', { dir: 'auto' }, [text])
  ])
  const links = cut ? [] : linksIn(text)
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

/**
 * A post's text. #352: an outline post (no text, when the host dropped _meta and the markdown part) shows its preview,
 * with "…" when the post is longer; cut is true then.
 */
export function postText(post) {
  if (typeof post === 'string') return { text: post, cut: false }
  if (post && typeof post.text === 'string') return { text: post.text, cut: false }
  const preview = String((post && post.preview) || '')
  return { text: preview + (post && post.chars > Array.from(preview).length ? '…' : ''), cut: true }
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
  const actions = el('div', {}, [])
  actions.className = 'actions'
  if (underEditorBase(thread.url, thread.editorBase)) actions.appendChild(linkButton('Open in editor', thread.url, open))
  if (typeof thread.expand === 'function') actions.appendChild(linkButton('Full screen', null, thread.expand))
  children.push(actions)
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

/**
 * #405 (B1 b): the changes of an edit's result to show, from _meta["x-thread/changes"] (server/mcp/edit-result.js):
 * null when there are none or the whole thread is to be shown. Each value reaches the page as text (rule 9).
 */
export function changesFrom(result) {
  const raw = result && result._meta && result._meta['x-thread/changes']
  return raw && Array.isArray(raw.posts) && raw.full !== true ? raw : null
}

/**
 * Shows only what an edit changed (#405): the heading and the new version, then each changed post as it is now (its
 * text before the edit above it) and each removed post's old text, then a button for the whole thread. With changes
 * null (get_draft with view compact), the heading and the button only.
 */
export function renderChanges(root, thread, changes, open) {
  const total = thread.posts.length
  const add = (node) => root.appendChild(node)
  const line = (text) => add(el('p', { dir: 'auto' }, [text]))
  const was = (label, text) => add(el('section', {}, [el('p', {}, [label]), el('p', { dir: 'auto' }, [String(text)])]))
  root.textContent = ''
  add(headerNode(thread, open))
  if (changes) {
    line('Saved · version ' + Number(changes.version) + ' · ' + changes.posts.length + ' changed')
    if (changes.title && typeof changes.title.before === 'string') was('Title before', changes.title.before)
    const label = { added: 'Added', edited: 'Edited', moved: 'Moved' }
    for (const c of changes.posts) {
      if (!c || typeof c !== 'object') continue
      const n = Number(c.index)
      if (c.status === 'removed') {
        line('Removed: was post ' + n)
        was('Text', c.before)
        continue
      }
      if (!Object.prototype.hasOwnProperty.call(label, c.status)) continue
      line(label[c.status] + ': post ' + n + (c.from ? ', was post ' + Number(c.from) : ''))
      if (c.status === 'edited' && c.before !== c.after) was('Before', c.before)
      if (n >= 1 && n <= total) add(postNode(thread, n - 1, total, open))
    }
  }
  const all = add(linkButton('Show all ' + total + ' posts', null, null))
  all.addEventListener('click', () => {
    renderThread(root, thread, open)
    if (typeof thread.drawn === 'function') thread.drawn()
  })
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
  const { source, saved } = threadSource(result)
  if (!Array.isArray(source.posts)) return null
  const outline = meta['x-thread/outline']
  return {
    title: source.title,
    posts: fullPosts(source.posts, meta, result) || source.posts,
    saved,
    is_published: source.is_published === true,
    url: typeof source.url === 'string' ? source.url : typeof structured.url === 'string' ? structured.url : null,
    counts: outline && Array.isArray(outline.posts) ? outline.posts : null,
    editorBase: typeof meta['x-thread/editorBase'] === 'string' ? meta['x-thread/editorBase'] : null,
    imageOrigin: typeof meta['x-thread/imageOrigin'] === 'string' ? meta['x-thread/imageOrigin'] : null,
    id: typeof source.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(source.id) ? source.id : null
  }
}

/** Where a result's posts are: the saved draft, a bare posts list, or (#352) the markdown part when neither is there. */
export function threadSource(result) {
  const structured = (result && result.structuredContent) || {}
  if (structured.draft) return { source: structured.draft, saved: true }
  if (Array.isArray(structured.posts)) return { source: structured, saved: false }
  const text = textThread(result)
  return { source: text || {}, saved: Boolean(text && text.saved) }
}

/**
 * The full posts (text, images) for an outline: from _meta["x-thread/posts"], else (#352) from the markdown part when
 * the posts have no text; each only when it matches in count. Null when neither has them: postNode shows the previews.
 */
export function fullPosts(posts, meta, result) {
  const same = (list) => (Array.isArray(list) && list.length === posts.length ? list : null)
  const textless = posts.some((post) => post && typeof post === 'object' && typeof post.text !== 'string')
  const text = textless ? textThread(result) : null
  return same(meta['x-thread/posts']) || (text ? same(text.posts) : null)
}

/**
 * The thread in the markdown text part of a tool result (server/mcp/thread-text.js): { title, posts, saved, url }, or
 * null. The count of posts must match the first line's count.
 */
export function textThread(result) {
  const parts = result && Array.isArray(result.content) ? result.content : []
  for (const part of parts) {
    const text = part && part.type === 'text' && typeof part.text === 'string' ? part.text : ''
    const head = text.match(/^Thread(?: "(.*)")?, (\d+) posts?, (saved as a draft|not saved yet)\.\n/)
    if (!head) continue
    const { posts, url } = markdownPosts(text.slice(head[0].length).split('\n'))
    if (posts.length !== Number(head[2])) return null
    return { title: head[1] || '', posts, saved: head[3] === 'saved as a draft', url }
  }
  return null
}

/** The posts in the markdown lines: a post is the quoted ("> ") lines after its "**n/N**" line, then its image and quoted-post lines. */
export function markdownPosts(lines) {
  const posts = []
  let url = null
  let current = null
  for (const line of lines) {
    if (line === 'Post text to copy:') break
    const mark = line.match(/^\*\*(\d+)\/\d+\*\*$/)
    const image = line.match(/^Image \d+: (\S+)$/)
    const quoted = line.match(/^Quoted post: (\S+)$/)
    if (mark && Number(mark[1]) === posts.length + 1) posts.push((current = { lines: [], images: [] }))
    else if (current && !current.images.length && (line === '>' || line.startsWith('> '))) current.lines.push(line.slice(2))
    else if (current && image) current.images.push({ url: image[1] })
    else if (current && quoted) current.embeddedTweet = quoted[1]
    else if (!url && !current && line.startsWith('Open: ')) url = line.slice(6)
    else current = null
  }
  return { posts: posts.map((post) => ({ text: post.lines.join('\n'), images: post.images, embeddedTweet: post.embeddedTweet })), url }
}
