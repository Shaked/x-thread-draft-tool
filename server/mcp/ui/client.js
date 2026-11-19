/* global window, document, ResizeObserver */
// Browser code for the MCP views (plan Task 1, D1 and D2). No imports: index.js and thread.js copy these
// functions into each view with Function.prototype.toString(), and the unit tests call them in jsdom.
// Draft text reaches the page only through text nodes and a fixed list of attributes (plan rule 9).
// Nothing here loads anything from another host, and nothing here sends data except postMessage (rule 10).

/** The bridge to the host: JSON-RPC 2.0 over postMessage with window.parent. `on` takes the callbacks. */
export function bridge(on) {
  const pending = new Map()
  let nextId = 1
  const state = { hostContext: null, delivered: false }

  function post(message) {
    window.parent.postMessage({ jsonrpc: '2.0', ...message }, '*')
  }

  function request(method, params) {
    const id = nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(method + ' timed out'))
      }, 15000)
      pending.set(id, { resolve, reject, timer })
      post({ id, method, params })
    })
  }

  function observeSize() {
    const report = () => {
      post({
        method: 'ui/notifications/size-changed',
        params: { width: Math.ceil(window.innerWidth), height: Math.ceil(document.documentElement.scrollHeight) }
      })
    }
    if (typeof ResizeObserver === 'function') new ResizeObserver(report).observe(document.body)
    report()
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
      state.hostContext = { ...state.hostContext, ...msg.params }
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
      state.hostContext = (result && result.hostContext) || {}
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
    /** Calls one of the server's tools as the signed-in user (a read-only call in these views). */
    callTool(name, args) {
      return request('tools/call', { name, arguments: args || {} })
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

/** An element with text children. Only alt, dir and title, and href after the https check, are ever set. */
export function el(tag, attrs, children) {
  const node = document.createElement(tag)
  const allowed = ['href', 'src', 'alt', 'dir', 'title']
  for (const name of Object.keys(attrs || {})) {
    if (!allowed.includes(name)) continue
    // A link goes in only after the https check. No image src in T1: an image needs its own check (Task 3).
    if (name === 'href') {
      const safe = safeUrl(attrs[name], null)
      if (safe) node.setAttribute('href', safe)
    } else if (name !== 'src') {
      node.setAttribute(name, attrs[name])
    }
  }
  for (const child of children || []) {
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child)
  }
  return node
}

/** Shows a thread (title and the text of each post) in root. Text is text: markup in a post stays plain text. */
export function renderThread(root, thread) {
  root.textContent = ''
  root.appendChild(el('h1', { dir: 'auto' }, [thread.title || 'Untitled draft']))
  const posts = Array.isArray(thread.posts) ? thread.posts : []
  if (posts.length === 0) root.appendChild(el('p', {}, ['This draft has no posts.']))
  for (const post of posts) {
    const text = typeof post === 'string' ? post : String((post && post.text) || '')
    root.appendChild(el('article', {}, [el('p', { dir: 'auto' }, [text])]))
  }
}

/** Shows one message in root in place of the thread. */
export function renderError(root, message) {
  root.textContent = ''
  root.appendChild(el('p', { dir: 'auto' }, [message]))
}

/** The thread in a tool's structuredContent: { draft: { title, posts } } or { posts }; null for anything else. */
export function threadFrom(structured) {
  const draft = structured && structured.draft ? structured.draft : structured
  if (draft && Array.isArray(draft.posts)) return { title: draft.title, posts: draft.posts }
  return null
}
