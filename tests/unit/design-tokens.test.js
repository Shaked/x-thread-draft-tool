// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Token lint (plan section 6, item 1): the values a page may use come from src/styles/tokens.css.
// Pure text checks. Every file is read once. Comments are removed first, so "#111" in a comment is not a colour.

const SRC = path.resolve('src')
const TOKENS = 'src/styles/tokens.css'

// Files that still break a rule. The list only shrinks: a listed file that is clean fails the test.
// Each entry leaves when its page migrates; Task 13 deletes the list.
const LEGACY = new Set([
  'src/components/ImageUpload.jsx',
  'src/components/PostBox.jsx',
  'src/pages/XThreadPreviewPage.jsx',
  'src/styles/App.css'
])

// `style=` props that stay, each with its reason.
const STYLE_PROP_ALLOWED = new Map([
  ['src/components/ThreadComposer.jsx', 'dnd-kit style={style} (drag transform) until Task 9 moves it to a custom property']
])

// Files that must not import CSS (page CSS lives in the shared components).
const NO_CSS_IMPORT = (file) => file.startsWith('src/pages/') || file === 'src/components/DraftList.jsx' || file === 'src/components/LoginPage.jsx'

const TOKEN_PROPS = ['font', 'font-family', 'font-size', 'font-weight', 'line-height', 'border-radius', 'box-shadow', 'z-index', 'transition', 'animation', 'opacity']
const KEYWORDS = ['inherit', 'initial', 'unset', 'revert', 'none', 'auto', '0']
const BREAKPOINTS = ['(width<360px)', '(width<600px)', '(width>=600px)', '(width<768px)', '(width>=768px)']
const COLOUR_WORDS = /\b(black|white|red|green|blue|gray|grey|silver|maroon|navy|olive|purple|teal|aqua|fuchsia|lime|yellow|orange|pink|brown|gold|cyan|magenta)\b/i
const HEX = /#[0-9a-fA-F]{3,8}\b/
const FUNC_COLOUR = /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i
const LENGTH = /(?<![\w.])(-?\d*\.?\d+)(px|rem|em|vh|vw|dvh|svh|lvh|ch|ms|s)(?!\w)/g
const DECLARATION = /([a-zA-Z_-][\w-]*)\s*:\s*([^;{}]+)[;}]/g

const stripCss = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '')
const stripJs = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1')

function colourIn(value) {
  const words = value.replace(/transparent|currentColor/gi, '')
  return HEX.test(value) || FUNC_COLOUR.test(value) || COLOUR_WORDS.test(words)
}

function lengthIn(value) {
  for (const [, number, unit] of value.matchAll(LENGTH)) {
    const n = Number(number)
    if (n === 0) continue
    if (unit === 'vh' || unit === 'dvh') {
      if (n === 100) continue
    }
    return `${number}${unit}`
  }
  return null
}

// Rules broken by one declaration (name, value).
function declarationRules(name, value, fileHasFocusVisible) {
  const broken = []
  if (colourIn(value)) broken.push('colour')
  if (lengthIn(value)) broken.push('length')
  // A token property takes a var(--…) value, or a keyword (opacity 0 and 1 need no token).
  if (TOKEN_PROPS.includes(name) && !value.includes('var(--')) {
    const keyword = KEYWORDS.includes(value) || (name === 'opacity' && (value === '1' || value === '0'))
    if (!keyword) broken.push('token-property')
  }
  if ((name === 'transition' || name === 'transition-property') && /^all\b/.test(value)) broken.push('transition-all')
  if ((name === 'outline' || name === 'outline-style') && /^(none|0)\b/.test(value) && !fileHasFocusVisible) broken.push('outline-none')
  if (/left|right/.test(name) || name === 'float' || (name === 'text-align' && /\b(left|right)\b/.test(value))) broken.push('physical')
  return broken
}

// Rule 'media': a width query that is not one of the five breakpoints.
function mediaBroken(css) {
  for (const [, query] of css.matchAll(/@media([^{]*)\{/g)) {
    for (const [, feature] of query.matchAll(/\(([^()]*)\)/g)) {
      if (/width/.test(feature) && !BREAKPOINTS.includes(`(${feature.replace(/\s+/g, '')})`)) return true
    }
  }
  return false
}

// Returns the rule ids a CSS text breaks (empty when clean).
export function lintCss(text, fileHasFocusVisible = /:focus-visible/.test(text)) {
  const css = stripCss(text)
  const broken = new Set()
  for (const [, prop, rawValue] of css.matchAll(DECLARATION)) {
    for (const rule of declarationRules(prop.toLowerCase(), rawValue.trim(), fileHasFocusVisible)) broken.add(rule)
  }
  if (mediaBroken(css)) broken.add('media')
  return [...broken].sort()
}

// Returns the rule ids a JS/JSX text breaks, for one file path (relative to the repo root).
export function lintJs(text, file = '') {
  const js = stripJs(text)
  const broken = new Set()
  const styleProps = [...js.matchAll(/\bstyle=/g)]
  if (styleProps.length > 0 && !STYLE_PROP_ALLOWED.has(file)) broken.add('style-prop')
  if (styleProps.length > 0 && STYLE_PROP_ALLOWED.has(file)) {
    const extra = [...js.matchAll(/\bstyle=(\{[^}]*\}|"[^"]*")/g)].filter((m) => m[1] !== '{style}')
    if (extra.length > 0) broken.add('style-prop')
  }
  for (const [, inner] of js.matchAll(/style=\{\{([\s\S]*?)\}\}/g)) {
    if (colourIn(inner)) broken.add('style-colour')
    if (lengthIn(inner)) broken.add('style-length')
  }
  if (NO_CSS_IMPORT(file) && /import\s[^'"]*['"][^'"]+\.css['"]/.test(js)) broken.add('css-import')
  // A src/ui/X.css (other than base.css) is imported only by src/ui/X.jsx.
  for (const [, spec] of js.matchAll(/import\s[^'"]*['"]([^'"]+\.css)['"]/g)) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec))
    const name = path.posix.basename(target, '.css')
    if (target.startsWith('src/ui/') && target !== 'src/ui/base.css' && file !== 'src/ui/' + name + '.jsx') broken.add('ui-css-import')
  }
  return [...broken].sort()
}

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

const repoPath = (full) => path.relative(path.resolve('.'), full).split(path.sep).join('/')
const files = walk(SRC).map((full) => ({ file: repoPath(full), text: readFileSync(full, 'utf8') }))
const cssFiles = files.filter((f) => f.file.endsWith('.css') && f.file !== TOKENS)
const jsFiles = files.filter((f) => /\.(jsx?|tsx?)$/.test(f.file))

function violationsOf(entry) {
  if (entry.file.endsWith('.css')) return lintCss(entry.text).map((rule) => `${entry.file}: ${rule}`)
  return lintJs(entry.text, entry.file).map((rule) => `${entry.file}: ${rule}`)
}

describe('token lint: self-check', () => {
  it('reports each CSS rule on a bad sample and nothing on a clean one', () => {
    const bad = [
      '.a { color: #123; }',
      '.a { background: rgb(1, 2, 3); }',
      '.a { color: black; }',
      '.a { padding: 12px; }',
      '.a { font-size: 1.5rem; }',
      '.a { font-weight: 600; }',
      '.a { border-radius: 50%; }',
      '.a { transition: all 0.2s; }',
      '.a { outline: none; }',
      '.a { margin-left: 4px; }',
      '.a { text-align: right; }',
      '@media (min-width: 600px) { .a { color: var(--color-text); } }'
    ].join('\n')
    expect(lintCss(bad)).toEqual(['colour', 'length', 'media', 'outline-none', 'physical', 'token-property', 'transition-all'])
    expect(lintCss('.a { padding: var(--space-4); color: var(--color-text); outline: none; } .a:focus-visible { outline: var(--focus-ring-width) solid var(--color-focus); }')).toEqual([])
    expect(lintCss('a { margin: 0; font: inherit; } .c { /* #111 and 9px in a comment */ opacity: 1; transition: none; }')).toEqual([])
  })

  it('reports each JS rule on a bad sample and nothing on a clean one', () => {
    expect(lintJs('const a = <div style={{ color: "#fff" }} />', 'src/x.jsx')).toEqual(['style-colour', 'style-prop'])
    expect(lintJs('const a = <div style={{ top: 4 }} />', 'src/x.jsx')).toEqual(['style-prop'])
    expect(lintJs('import "../x.css"', 'src/pages/P.jsx')).toEqual(['css-import'])
    expect(lintJs('import "../ui/Card.css"', 'src/components/Foo.jsx')).toEqual(['ui-css-import'])
    expect(lintJs('import "../ui/Card.css"', 'src/components/Card.jsx')).toEqual(['ui-css-import'])
    expect(lintJs('import "../Card.css"', 'src/ui/sub/Card.jsx')).toEqual(['ui-css-import'])
    expect(lintJs('import "./Card.css"', 'src/ui/Card.jsx')).toEqual([])
    expect(lintJs('import "./ui/base.css"', 'src/main.jsx')).toEqual([])
    expect(lintJs('// <div style={{ color: "#fff" }} />\nconst a = 1', 'src/x.jsx')).toEqual([])
  })
})

describe('token lint: files', () => {
  it('keeps every file outside LEGACY free of breaks', () => {
    const broken = [...cssFiles, ...jsFiles]
      .filter((f) => !LEGACY.has(f.file))
      .flatMap(violationsOf)
    expect(broken).toEqual([])
  })

  it('keeps LEGACY to files that still break a rule', () => {
    const clean = [...LEGACY].filter((file) => {
      const entry = files.find((f) => f.file === file)
      return !entry || violationsOf(entry).length === 0
    })
    expect(clean).toEqual([])
  })
})
