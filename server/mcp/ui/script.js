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

// A string, or a regex literal (after one of ( , = : [ ! & | ? { } ; or return, so a division is not taken for one): both are left as they are.
const REGEX_OR_STRING = /('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|(?<=[(,=:[!&|?{};]\s*|\breturn\s+|^)\/(?![/*])(?:[^/\\\n[]|\\.|\[(?:[^\]\\\n]|\\.)*\])+\/[a-z]*)/

/** The code with the spaces around the operators in SPACED, after a comma or colon and between ) and { and inside { }, and a ; before }, the space before return, throw and else, the spaces around + - and * (unless a + or - follows), removed, the space after if, for, while, catch, switch and function before (, const written let, true and false written !0 and !1; the text of string literals is left as it is. */
function tighten(code) {
  return code
    .split(REGEX_OR_STRING)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(SPACED, '$1').replace(/([,:]) /g, '$1').replace(/\) \{/g, '){').replace(/\b(if|for|while|catch|switch|function) \(/g, '$1(').replace(/ ([+*-]) (?![+-])/g, '$1').replace(/;\}/g, '}').replace(/\breturn (?=[[{(!]|$)/g, 'return').replace(/\) (return|throw)\b/g, ')$1').replace(/\} else\b/g, '}else').replace(/\belse \{/g, 'else{').replace(/\{ /g, '{').replace(/ \}/g, '}').replace(/\bconst\b/g, 'let').replace(/\btrue\b/g, '!0').replace(/\bfalse\b/g, '!1')))
    .join('')
}

/** The source of the page's labels() with only these sections ('thread', 'drafts', 'share'). */
function labelsSource(sections) {
  const all = labels()
  return `function labels() { return ${escapeForScript(JSON.stringify(Object.fromEntries(sections.map((name) => [name, all[name]]))))} }`
}

/** The page script: the label sections, then each function's source, then the starter, compacted. */
export function pageScript(sections, functions, starter) {
  const code = compact([labelsSource(sections), ...functions.map((fn) => fn.toString().replace(/\/\*[\s\S]*?\*\//g, ''))].join('\n'), true)
  // A line that ends in ; and has no // is joined to the next (the compact tests pin compact itself, so this is a step of its own).
  return code.replace(/^([^\n]*;)\n/gm, (m, line) => (line.includes('//') ? m : line)) + '\n' + compact(starter)
}

/** CSS without comments, line breaks or the spaces around { } : ; and , (no selector here has a space before a colon). */
export function minifyCss(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s*([{}:;,])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim()
}
