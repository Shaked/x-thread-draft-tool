// The page script of a view (#371): the functions copied by source text, the label sections the view uses, and a
// compacting step. The 32 KB limit on a view (tests/api/mcp-ui.test.js) is kept by writing less, not by raising it:
// Hebrew labels cost two bytes a letter, so each view carries only its own sections, without indentation or comment lines.
import { labels } from './client.js'
import { escapeForScript } from './origin.js'

/**
 * The text with each line's indentation, full-line // comments and blank lines removed, and a line break dropped where it
 * cannot change the parse: after a line ending in { ( [ or a comma, and before a line starting with } ) ] or a dot. A template literal makes it throw. A line
 * with a // in it is never joined to the next. No function here holds a multi-line string. With tight, the spaces around
 * some operators are removed too (not for the starter, whose text tests read).
 */
export function compact(source, tight = false) {
  if (source.includes('`')) throw new Error('page script: a template literal is not allowed (the compacting would change it)')
  const out = []
  for (const line of source.split('\n').map((l) => l.trim())) {
    if (line === '' || line.startsWith('//')) continue
    const prev = out[out.length - 1]
    if (prev !== undefined && !prev.includes('//') && (/[{([,]$/.test(prev) || /^[})\].]/.test(line))) out[out.length - 1] = prev + line
    else out.push(line)
  }
  const text = out.join('\n')
  return tight ? tighten(text) : text
}

// The spaces around these operators, outside string literals, are not needed: a=b, a&&b, a?b:c. (Not + or -: a + +b.)
const SPACED = / (=>|===|!==|==|!=|>=|<=|\?\?|&&|\|\||[=?:<>]) /g

/** The code with the spaces around the operators in SPACED removed; the text of string literals is left as it is. */
function tighten(code) {
  return code
    .split(/('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*")/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(SPACED, '$1')))
    .join('')
}

/** The source of the page's labels() with only these sections ('thread', 'drafts', 'share'). */
function labelsSource(sections) {
  const all = labels()
  return `function labels() { return ${escapeForScript(JSON.stringify(Object.fromEntries(sections.map((name) => [name, all[name]]))))} }`
}

/** The page script: the label sections, then each function's source, then the starter, compacted. */
export function pageScript(sections, functions, starter) {
  return compact([labelsSource(sections), ...functions.map((fn) => fn.toString())].join('\n'), true) + '\n' + compact(starter)
}

/** CSS without comments, line breaks or the spaces around { } : ; and , (no selector here has a space before a colon). */
export function minifyCss(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s*([{}:;,])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim()
}
