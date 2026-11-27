// #420: the page script is compacted a little more so the thread view stays under 32 KB. This pins the rules and that
// strings and regex literals are left as they are, and runs the compacted text parser of the built view on the server's text.
import { describe, expect, it } from 'vitest'
import { compact } from '../../server/mcp/ui/script.js'
import { THREAD_VIEW } from '../../server/mcp/ui/thread.js'
import { threadText } from '../../server/mcp/thread-text.js'

describe('the tight compacting rules', () => {
  const tight = (code) => compact(code, true)
  it('removes the spaces after a comma or colon, around { }, after if/for/function and before return/else', () => {
    expect(tight('f(a, b)')).toBe('f(a,b)')
    expect(tight('x = { a: 1 }')).toBe('x={a:1}')
    expect(tight('if (a) return b')).toBe('if(a)return b')
    expect(tight('function (a) { return [a] }')).toBe('function(a){return[a]}')
    expect(tight('if (a) {\n  b()\n} else {\n  c()\n}')).toBe('if(a){b()}else{c()}')
  })
  it('writes const as let, true and false as !0 and !1, undefined as void 0, and drops a ; before }', () => {
    expect(tight('const a = true')).toBe('let a=!0')
    expect(tight('x = b === false')).toBe('x=b===!1')
    expect(tight('x = a === undefined')).toBe('x=a===void 0')
    expect(tight('f(() => { g();})')).toBe('f(()=>{g()})')
  })
  it('removes the spaces around + - and *, except before a following + or -', () => {
    expect(tight('x = a + b - c * d')).toBe('x=a+b-c*d')
    expect(tight('x = a + +b')).toBe('x=a + +b')
    expect(tight('x = a - -b')).toBe('x=a - -b')
  })
  it('leaves strings and regex literals as they are', () => {
    expect(tight('x = "a, b: const true + 1"')).toBe('x="a, b: const true + 1"')
    expect(tight("x = s.match(/^Image \\d+: (\\S+), const true$/)")).toBe("x=s.match(/^Image \\d+: (\\S+), const true$/)")
    expect(tight('x = a / b + c / d')).toBe('x=a / b+c / d')
  })
})

describe('the compacted text parser of the thread view', () => {
  it('reads the server markdown thread, with its saved line, posts and quoted post', () => {
    const html = THREAD_VIEW.html(null)
    const chunks = html.split(/\n(?=function )/)
    const part = (name) => chunks.find((c) => c.startsWith(`function ${name}(`))
    const parse = new Function(`${part('textThread')}\n${part('markdownPosts')}\nreturn textThread`)()
    const text = threadText({
      title: 'My "thread"',
      posts: [{ text: 'one\ntwo', images: [{ url: 'https://img.example/a.png' }] }, { text: 'second', embeddedTweet: 'https://x.com/jack/status/20' }],
      url: 'https://app.example/draft/1',
      saved: true
    })
    const found = parse({ content: [{ type: 'text', text }] })
    expect(found.saved).toBe(true)
    expect(found.posts.map((p) => p.text)).toEqual(['one\ntwo', 'second'])
    expect(found.posts[1].embeddedTweet).toBe('https://x.com/jack/status/20')
  })
})
