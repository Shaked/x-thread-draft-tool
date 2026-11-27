// #420: the page script is compacted a little more so the thread view stays under 32 KB. This pins the rules and that
// strings and regex literals are left as they are, and runs the compacted text parser of the built view on the server's text.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { compact, pageScript } from '../../server/mcp/ui/script.js'
import { DRAFTS_VIEW } from '../../server/mcp/ui/drafts.js'
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
  it('removes the space between for, while, catch, switch and (, and between ) and throw', () => {
    expect(tight('for (let i = 0; i < n; i++) { f(i) }')).toBe('for(let i=0; i<n; i++){f(i)}')
    expect(tight('while (a) { b() }')).toBe('while(a){b()}')
    expect(tight('try { a() } catch (err) { b() }')).toBe('try {a()} catch(err){b()}')
    expect(tight('switch (a) { default: b() }')).toBe('switch(a){default:b()}')
    expect(tight('if (a) throw b')).toBe('if(a)throw b')
  })
  it('removes the space after return before { [ ( ! and before a string', () => {
    expect(tight('return { a: 1 }')).toBe('return{a:1}')
    expect(tight('return [a]')).toBe('return[a]')
    expect(tight('return (a)')).toBe('return(a)')
    expect(tight('return !a')).toBe('return!a')
    expect(tight('return "a b"')).toBe('return"a b"')
    expect(tight('return a')).toBe('return a')
  })
  it('leaves strings and regex literals as they are', () => {
    expect(tight('x = "a, b: const true + 1"')).toBe('x="a, b: const true + 1"')
    expect(tight("x = s.match(/^Image \\d+: (\\S+), const true$/)")).toBe("x=s.match(/^Image \\d+: (\\S+), const true$/)")
    expect(tight('x = a / b + c / d')).toBe('x=a / b+c / d')
  })
})

describe('pageScript', () => {
  // A source text, not a function: the test transform removes the comments of a real function.
  const source = 'function pair() {\n  /* a block comment, dropped */\n  const a = 1;\n  const b = 2;\n  return a + b; // kept\n}'
  it('drops block comments in functions and joins a line ending in ; to the next, unless it has a // comment', () => {
    const script = pageScript([], [{ toString: () => source }], 'start()')
    expect(script).not.toContain('block comment')
    expect(script).toContain('function pair(){let a=1;let b=2;return a+b; // kept\n}')
  })
})

const TOKEN = 'vercel_blob_rw_abc123def_secret'
const IMAGE = 'https://abc123def.public.blob.vercel-storage.com/drafts/u/1.png'

describe('the compacted text parser of the views', () => {
  afterEach(() => vi.unstubAllEnvs())
  for (const view of [THREAD_VIEW, DRAFTS_VIEW]) {
    it(`reads the server markdown thread in the ${view.name} view: title, saved, url, posts, images, quoted post`, () => {
      vi.stubEnv('BLOB_READ_WRITE_TOKEN', TOKEN)
      const chunks = view.html(null).split(/\n(?=function )/)
      const part = (name) => chunks.find((c) => c.startsWith(`function ${name}(`))
      const parse = new Function(`${part('textThread')}\n${part('markdownPosts')}\nreturn textThread`)()
      const text = threadText({
        title: 'My "thread"',
        posts: [
          { text: 'one\ntwo', images: [{ url: IMAGE }, { url: IMAGE + '?b' }] },
          { text: 'second', embeddedTweet: 'https://x.com/jack/status/20' }
        ],
        url: 'https://app.example/draft/1',
        saved: true
      })
      expect(text).toContain(`Image 1: ${IMAGE}`)
      expect(parse({ content: [{ type: 'text', text }] })).toEqual({
        title: 'My "thread"',
        saved: true,
        url: 'https://app.example/draft/1',
        posts: [
          { text: 'one\ntwo', images: [{ url: IMAGE }, { url: IMAGE + '?b' }], embeddedTweet: undefined },
          { text: 'second', images: [], embeddedTweet: 'https://x.com/jack/status/20' }
        ]
      })
    })
  }
})
