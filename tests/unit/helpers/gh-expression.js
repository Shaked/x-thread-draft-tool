// A small evaluator for the subset of GitHub Actions expressions used in a job `if:`:
// context paths, string/number/bool/null literals, ! == != && || ( ), format(), contains(), fromJSON().
// It follows GitHub's rules: operands of different types are coerced to numbers (null is 0, '' is 0, a
// non-numeric string is NaN), strings compare ignoring case, && and || return an operand, and falsy is
// false, 0, '', null or NaN. A missing context value is null.

const num = (v) => {
  if (v === null || v === undefined) return 0
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'number') return v
  if (typeof v === 'string') return v.trim() === '' ? 0 : Number(v)
  return NaN
}

const truthy = (v) => !(v === false || v === 0 || v === '' || v === null || v === undefined || Number.isNaN(v))

export function looseEquals(a, b) {
  const x = a === undefined ? null : a
  const y = b === undefined ? null : b
  if (x === null && y === null) return true
  if (typeof x === 'string' && typeof y === 'string') return x.toLowerCase() === y.toLowerCase()
  if (typeof x !== typeof y || x === null || y === null) return num(x) === num(y)
  return x === y
}

function tokenize(src) {
  const out = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) { i++; continue }
    if (c === "'") {
      let s = ''
      i++
      while (i < src.length && !(src[i] === "'" && src[i + 1] !== "'")) {
        if (src[i] === "'" && src[i + 1] === "'") { s += "'"; i += 2 } else s += src[i++]
      }
      i++
      out.push({ t: 'str', v: s })
      continue
    }
    const two = src.slice(i, i + 2)
    if (['&&', '||', '==', '!='].includes(two)) { out.push({ t: two }); i += 2; continue }
    if ('!(),'.includes(c)) { out.push({ t: c }); i++; continue }
    const m = /^[A-Za-z_][\w.-]*|^\d+(\.\d+)?/.exec(src.slice(i))
    if (!m) throw new Error(`cannot read the expression at: ${src.slice(i)}`)
    out.push({ t: 'word', v: m[0] })
    i += m[0].length
  }
  return out
}

/** Evaluates `src` with a context object, e.g. { vars: { X: 'on' }, github: { event_name: 'schedule' } }. */
export function evaluate(src, ctx) {
  const toks = tokenize(src)
  let p = 0
  const peek = () => toks[p]?.t
  const eat = (t) => {
    if (toks[p]?.t !== t) throw new Error(`expected ${t}`)
    return toks[p++]
  }
  const lookup = (path) => path.split('.').reduce((o, k) => (o === null || o === undefined ? null : (o[k] ?? null)), ctx)
  const call = (name, args) => {
    switch (name.toLowerCase()) {
      case 'format': return args[0].replace(/\{(\d+)\}/g, (_, n) => String(args[Number(n) + 1] ?? ''))
      case 'fromjson': return JSON.parse(args[0])
      case 'contains': {
        const [search, item] = args
        if (Array.isArray(search)) return search.some((e) => looseEquals(e, item))
        return String(search ?? '').toLowerCase().includes(String(item ?? '').toLowerCase())
      }
      default: throw new Error(`function ${name} is not supported`)
    }
  }
  const primary = () => {
    if (peek() === '(') { eat('('); const v = or(); eat(')'); return v }
    if (peek() === '!') { eat('!'); return !truthy(primary()) }
    const tok = eat(peek() === 'str' ? 'str' : 'word')
    if (tok.t === 'str') return tok.v
    if (peek() === '(') {
      eat('(')
      const args = []
      if (peek() !== ')') for (;;) { args.push(or()); if (peek() === ',') eat(','); else break }
      eat(')')
      return call(tok.v, args)
    }
    if (tok.v === 'null') return null
    if (tok.v === 'true') return true
    if (tok.v === 'false') return false
    if (/^\d/.test(tok.v)) return Number(tok.v)
    return lookup(tok.v)
  }
  const eq = () => {
    let v = primary()
    while (peek() === '==' || peek() === '!=') {
      const op = toks[p++].t
      const r = primary()
      v = op === '==' ? looseEquals(v, r) : !looseEquals(v, r)
    }
    return v
  }
  const and = () => {
    let v = eq()
    while (peek() === '&&') { eat('&&'); const r = eq(); v = truthy(v) ? r : v }
    return v
  }
  const or = () => {
    let v = and()
    while (peek() === '||') { eat('||'); const r = and(); v = truthy(v) ? v : r }
    return v
  }
  const result = or()
  if (p !== toks.length) throw new Error('unexpected text after the expression')
  return truthy(result)
}
