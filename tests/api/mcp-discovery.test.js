// @vitest-environment node
// Implements #273 Task 4 (issue #278): the offline discovery score (tests/eval/discovery/score.mjs) must not fall
// below the recorded baseline. No database, no network, no model. Runs in well under 2 s.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { listTools } from '../../server/mcp/tools.js'
import { listAdminTools } from '../../server/mcp/admin-tools.js'
import { getPrompt, listPrompts } from '../../server/mcp/prompts.js'
import { readSkillResource } from '../../server/mcp/skills.js'
import { threadText } from '../../server/mcp/thread-text.js'
import { INSTRUCTIONS } from '../../server/mcp/server.js'
import { labels } from '../../server/mcp/ui/client.js'
import { changeMeta, changesText } from '../../server/mcp/edit-result.js'
import { stateLine } from '../../server/mcp/state-line.js'
import { WRITE_TOOLS } from '../eval/mcp-default-use.eval.mjs'
import { MODES, NAMES_CONNECTOR, POOLS, checkAgainst, clientScores, evaluate, formatClientTable, formatTable, loadStats, modeFor, rank, statsKey, tokenize } from '../eval/discovery/score.mjs'
import { fenceProblems, formatEval, formatEvalTable } from '../eval/discovery/format.mjs'

const dir = new URL('../eval/discovery/', import.meta.url)
const read = (name) => JSON.parse(readFileSync(new URL(name, dir), 'utf8'))
const { intents, negatives } = read('intents.json')
const baseline = read('baseline.json')
const clients = read('clients.json')
const tools = listTools()
const toolNames = new Set(tools.map((t) => t.name))
const URL_RE = /^https:\/\/\S+$/

describe('discovery corpus', () => {
  it('has 22 intents, each with at least 4 English and 4 Hebrew phrases', () => {
    expect(intents).toHaveLength(22)
    for (const intent of intents) {
      for (const lang of ['en', 'he']) {
        expect(intent.phrases.filter((p) => p.lang === lang).length, `${intent.id} ${lang}`).toBeGreaterThanOrEqual(4)
      }
    }
  })

  it('has at least 2 phrases per language per intent that name neither X, Twitter, the connector nor a draft', () => {
    for (const intent of intents) {
      for (const lang of ['en', 'he']) {
        const plain = intent.phrases.filter((p) => p.lang === lang && !NAMES_CONNECTOR.test(p.text))
        expect(plain.length, `${intent.id} ${lang}`).toBeGreaterThanOrEqual(2)
      }
    }
  })

  it('gives every positive phrase expected tools that exist in the real tool list', () => {
    for (const intent of intents) {
      for (const p of intent.phrases) {
        expect(p.expect.length, p.text).toBeGreaterThan(0)
        for (const name of p.expect) expect(toolNames.has(name), `${name} in "${p.text}"`).toBe(true)
      }
    }
  })

  it('has 8 negatives per language, and no negative phrase is a save request', () => {
    for (const lang of ['en', 'he']) expect(negatives.filter((n) => n.lang === lang)).toHaveLength(8)
    for (const n of negatives) expect(n.text).not.toMatch(/write|draft|כתוב|טיוטה|תכתוב/i)
  })

  it('has no duplicate phrase text', () => {
    const texts = [...intents.flatMap((i) => i.phrases.map((p) => p.text)), ...negatives.map((n) => n.text)]
    expect(new Set(texts).size).toBe(texts.length)
  })
})

describe('client profiles', () => {
  const FIELDS = ['reads_instructions', 'shows_prompts', 'reads_resources', 'renders_ui_views', 'reads_tool_title']

  it('lists the seven clients, each with every field, a value and a source', () => {
    expect(Object.keys(clients.clients).sort()).toEqual(['chatgpt', 'claude_ai', 'claude_code', 'claude_desktop', 'codex', 'generic', 'grok'])
    for (const [name, profile] of Object.entries(clients.clients)) {
      for (const field of FIELDS) {
        const { value, source } = profile[field] ?? {}
        expect([true, false, 'not checked'], `${name}.${field}`).toContain(value)
        // A "not checked" value may name the page that was read but did not state the fact; true or false needs that page.
        if (value === 'not checked') expect(source === 'not checked' || URL_RE.test(source), `${name}.${field}`).toBe(true)
        else expect(source, `${name}.${field}`).toMatch(URL_RE)
      }
    }
  })
})

describe('discovery score', () => {
  const report = evaluate({ tools, instructions: INSTRUCTIONS, intents, negatives, admin: listAdminTools() })

  it('has a recorded floor for every intent, language and mode, and a threshold for every negative', () => {
    for (const mode of MODES) {
      for (const intent of intents) {
        for (const lang of ['en', 'he']) expect(baseline.modes[mode].cells[intent.id]?.[lang], `${mode} ${intent.id} ${lang}`).toBeDefined()
      }
      for (const lang of ['en', 'he']) expect(baseline.modes[mode].negatives[lang], `${mode} negatives ${lang}`).toBeDefined()
    }
  })

  it('is not below the recorded baseline (top-1, top-3, margin, negatives, admin)', () => {
    console.log(formatTable(report))
    const failures = checkAgainst(report, baseline)
    expect(failures, failures.join('\n')).toEqual([])
  })

  it('never lets an admin tool rank first for a normal phrase, except the recorded known failures', () => {
    const offending = report.adminFirst.filter((hit) => !baseline.known_failures.some((k) => k.kind === 'admin_first' && k.mode === hit.mode && k.text === hit.text))
    expect(offending).toEqual([])
  })

  it('keeps admin tool names out of the MCP prompts that every client can list', () => {
    const adminNames = listAdminTools().map((t) => t.name)
    const prompts = listPrompts()
    for (const prompt of prompts) {
      const text = `${prompt.name} ${prompt.title} ${prompt.description}`
      for (const name of adminNames) expect(text.includes(name), `${prompt.name} mentions ${name}`).toBe(false)
    }
  })

  it('keeps the best write-tool score of each negative at or below its threshold', () => {
    expect(WRITE_TOOLS.length).toBeGreaterThan(0)
    for (const mode of MODES) {
      for (const lang of ['en', 'he']) {
        expect(report.modes[mode].negatives[lang].max_write_score).toBeLessThanOrEqual(baseline.modes[mode].negatives[lang].max_write_score)
      }
    }
  })
})

// Implements #273 Task 5 (scorer): the corpus statistics are frozen in stats.json, so one tool's text moves only its own scores.
describe('frozen corpus statistics', () => {
  const stats = loadStats()
  const admin = listAdminTools()
  const allPhrases = [...intents.flatMap((i) => i.phrases), ...negatives].map((p) => p.text)
  const scoresOf = (list, phrase, mode) => Object.fromEntries(rank(phrase, list, { instructions: mode === 'with_instructions' ? INSTRUCTIONS : undefined, stats: stats.pools[statsKey('normal', mode)] }).map((r) => [r.name, r.score]))
  const edit = (list, name, change) => list.map((t) => (t.name === name ? { ...t, ...change(t) } : t))

  it('(a) changing one tool description leaves every other tool score for every phrase bit-identical', () => {
    for (const target of ['create_draft', 'list_drafts', 'whoami']) {
      const changed = edit(tools, target, (t) => ({ description: `${t.description} publish tweet schedule quickly twitter שרשור new words zzqqxx` }))
      for (const mode of MODES) {
        for (const phrase of allPhrases) {
          const before = scoresOf(tools, phrase, mode)
          const after = scoresOf(changed, phrase, mode)
          for (const name of Object.keys(before)) if (name !== target) expect(after[name], `${mode} ${target} -> ${name} "${phrase}"`).toBe(before[name])
        }
      }
    }
  })

  it('(b) a token that is not in the statistics gets df=1 (a new word counts as rare)', () => {
    const [mode, word] = ['tools_only', 'zzqqxxnovel']
    const s = stats.pools[statsKey('normal', mode)]
    expect(Object.hasOwn(s.df, word)).toBe(false)
    const target = tools[0]
    const changed = edit(tools, target.name, (t) => ({ description: `${t.description} ${word}` }))
    const doc = [target.name.replace(/_/g, ' '), target.title ?? '', `${target.description} ${word}`]
    const dl = tokenize(doc.join(' ')).length
    const idf = Math.log(1 + (s.N - 1 + 0.5) / (1 + 0.5))
    expect(scoresOf(changed, word, mode)[target.name]).toBeCloseTo(idf * (1 * 2.2) / (1 + 1.2 * (1 - 0.75 + (0.75 * dl) / s.avgdl)), 12)
    for (const other of tools.filter((t) => t.name !== target.name)) expect(scoresOf(changed, word, mode)[other.name]).toBe(0)
  })

  it('counts a word like "constructor" as a plain token, not an inherited property', () => {
    const list = [{ name: 'one', description: 'constructor' }, { name: 'two', description: 'something else' }]
    const scores = rank('constructor', list).map((r) => r.score)
    for (const score of scores) expect(Number.isFinite(score)).toBe(true)
    expect(scores[0]).toBeGreaterThan(scores[1])
    expect(rank('constructor', list, { stats: stats.pools['normal/tools_only'] }).every((r) => Number.isFinite(r.score))).toBe(true)
  })

  it('(c) the gates still fail on purpose-made regressions', () => {
    const run = (list, adminList = admin) => evaluate({ tools: list, instructions: INSTRUCTIONS, intents, negatives, admin: adminList })
    expect(checkAgainst(run(tools), baseline)).toEqual([])
    // A top-1 drop: a winning tool loses its text.
    const winners = new Set(intents.flatMap((i) => i.phrases.filter((p) => p.lang === 'en').flatMap((p) => p.expect)))
    const blanked = tools.map((t) => (winners.has(t.name) ? { ...t, description: 'x', title: 'x' } : t))
    expect(checkAgainst(run(blanked), baseline).join('\n')).toMatch(/top-1 \d+ is below the floor/)
    // An admin_first hit: an admin tool takes the words of a normal phrase and ranks first, not in known_failures.
    const phrase = intents[0].phrases.find((p) => p.lang === 'en').text
    const hijacked = admin.map((t, i) => (i === 0 ? { ...t, description: `${phrase} ${phrase} ${phrase}` } : t))
    expect(checkAgainst(run(tools, hijacked), baseline).join('\n')).toMatch(/admin tool .* ranks first for/)
    // A negative ceiling that rises: the edited write tool itself now scores higher on a no-tool phrase.
    const negative = negatives.find((n) => n.lang === 'en').text
    const writer = WRITE_TOOLS[0]
    const risen = edit(tools, writer, (t) => ({ description: `${t.description} ${negative} ${negative}` }))
    expect(checkAgainst(run(risen), baseline).join('\n')).toMatch(/negatives en: a write tool scores .* above/)
  })

  it('(d) stats.json has every pool and mode, sized to the live tool lists', () => {
    expect(Object.keys(stats.pools).sort()).toEqual(POOLS.flatMap((pool) => MODES.map((mode) => statsKey(pool, mode))).sort())
    for (const pool of POOLS) {
      for (const mode of MODES) {
        const s = stats.pools[statsKey(pool, mode)]
        expect(s.N, `${pool} ${mode} N (add or remove a tool: run --refresh-stats)`).toBe(pool === 'normal' ? tools.length : tools.length + admin.length)
        expect(s.avgdl).toBeGreaterThan(0)
        expect(Object.keys(s.df).length).toBeGreaterThan(50)
        for (const df of Object.values(s.df)) expect(df).toBeGreaterThanOrEqual(1)
      }
    }
  })
})

describe('per client (#365)', () => {
  const report = evaluate({ tools, instructions: INSTRUCTIONS, intents, negatives, admin: listAdminTools() })

  it('scores each client in the mode its reads_instructions value gives, and no client falls below the floors of that mode', () => {
    expect(modeFor({ reads_instructions: { value: true } })).toBe('with_instructions')
    for (const value of [false, 'not checked']) expect(modeFor({ reads_instructions: { value } })).toBe('tools_only')
    const rows = clientScores(report, clients, baseline)
    console.log(formatClientTable(rows))
    expect(rows).toHaveLength(Object.keys(clients.clients).length * clients.languages.length)
    for (const row of rows) {
      expect(row.mode, row.client).toBe(modeFor(clients.clients[row.client]))
      expect(row.top1, `${row.client} ${row.lang} top-1`).toBeGreaterThanOrEqual(row.floor_top1)
      expect(row.top3, `${row.client} ${row.lang} top-3`).toBeGreaterThanOrEqual(row.floor_top3)
    }
  })

  it('format eval: no code fence around post text, Hebrew kept exactly, within the length limits, for every client', () => {
    const editText = (before, after) => changesText(changeMeta(before, after))
    const server = { instructions: INSTRUCTIONS, tools, prompts: listPrompts(), getPrompt, skillText: readSkillResource('skill://x-thread-drafts/SKILL.md')[0].text, threadText, editText, stateLine, viewLabels: labels() }
    const { problems, rows } = formatEval(clients, server)
    console.log(formatEvalTable(rows))
    expect(problems, problems.join('\n')).toEqual([])
    expect(rows.filter((r) => r.group === 'prompts')).toHaveLength(Object.keys(clients.clients).length)
    // A direction mark the server adds around the user's text is found (Codex review on #399).
    const marked = formatEval(clients, { ...server, threadText: (args) => `\u202e${threadText(args)}` }).problems
    expect(marked.join('\n')).toContain('results thread markdown (he): Hebrew or user text is not kept exactly as written')
    // #371: a direction mark inside a Hebrew view label is found, for every client that shows views.
    const hebrew = labels()
    hebrew.thread.draft = ['Draft', '\u202bטיוטה']
    const labelProblems = formatEval(clients, { ...server, viewLabels: hebrew }).problems.join('\n')
    expect(labelProblems).toContain('views thread.draft (he): Hebrew or user text is not kept exactly as written')
    expect(rows.filter((r) => r.group === 'views').length).toBeGreaterThan(0)
    // #405: an edit result that shows the whole draft again fails, in English and Hebrew.
    const whole = formatEval(clients, { ...server, editText: (before, after) => `${editText(before, after)}\n${threadText({ ...after, saved: true })}` }).problems
    for (const lang of ['en', 'he']) expect(whole.join('\n')).toContain(`results edit result (${lang}): shows 5 posts the edit did not change`)
    // #390: a state line that holds the title, a post or an image url fails, in English and Hebrew.
    const leaky = formatEval(clients, { ...server, stateLine: (draft, ...rest) => `${stateLine(draft, ...rest)} ${draft.title}` }).problems
    for (const lang of ['en', 'he']) expect(leaky.join('\n')).toContain(`results state line (${lang}): holds user text`)
  })

  it('format eval: finds a code fence around text, and allows only the fences that text may hold', () => {
    expect(fenceProblems('Option 1:\n```\nשלום\n```')).toHaveLength(1)
    const user = "Notes (the user's own text, between the fences):\n````\na ``` b\n`````"
    expect(fenceProblems(user, { allowed: ['user'] })).toEqual([])
    expect(fenceProblems(user, { allowed: ['copy'] })).toHaveLength(1)
    const copy = 'Post text to copy:\n```text\na\n```'
    expect(fenceProblems(copy, { allowed: ['copy'] })).toEqual([])
    expect(fenceProblems(copy)).toHaveLength(1)
    expect(fenceProblems(`${copy}\n${copy}`, { allowed: ['copy'] })).toEqual(['more than one copy block'])
    // Server text that asks the assistant to write a code block fails; the same words in user text do not.
    expect(fenceProblems('Show each option as a code block so the user can copy it.', { server: true })).toHaveLength(1)
    expect(fenceProblems('Put each inside its own ``` block.', { server: true })).toHaveLength(1)
    expect(fenceProblems('Put each inside its own ``` block.')).toEqual([])
  })
})

// #395 (task W6): the owner observations in clients.json. An observation is a report that names its issue; it never sets a
// `value` (those stay "not checked" unless a document was read).
describe('client observations', () => {
  it('each observed entry has a date, what the owner saw, and the issue it came from', () => {
    for (const [name, profile] of Object.entries(clients.clients)) {
      for (const observation of profile.observed ?? []) {
        expect(observation.date, name).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(observation.what.length, name).toBeGreaterThan(10)
        expect(observation.source, name).toMatch(/^https:\/\/github\.com\/Shaked\/x-thread-draft-tool\/issues\/\d+$/)
      }
    }
    expect(clients.clients.chatgpt.observed.length).toBeGreaterThan(0)
  })
})
