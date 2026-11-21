// Implements #273 Task C1 (issue #365): the format eval. Free and deterministic: no model, no network.
// For each client profile in clients.json it takes the server-written text that client is sent (instructions, tool
// descriptions, prompts and their messages, the skill, the thread result as markdown) and checks three rules:
//   1. no code fence, except a deliberate one: the fence around the user's own text in a prompt (D-13) or the one
//      "Post text to copy:" block of a thread result (#352). A post shown in a code block is hard to read (#358).
//   2. Hebrew stays as written: the user's Hebrew comes back byte for byte, and server text adds no direction marks.
//   3. each text fits its length limit.
// A part that clients.json says the client does not read (false) is skipped for that client; "not checked" counts
// as read, the safe case. tests/api/mcp-discovery.test.js runs it and prints the table.
import { isCleanServerText } from '../../../server/mcp/language.js'

const FENCE = /^\s*(`{3,}|~{3,})/
// The line before a deliberate fence. Anything else that opens a fence is a problem.
const ALLOWED_BEFORE = [/\(the user's own text, between the fences\):$/, /^Post text to copy:$/]
const COPY_LABEL = 'Post text to copy:'
export const SAMPLES = {
  en: 'Coffee notes: one `tick`, two ``` fences, **bold** and a link https://example.com',
  he: 'שָׁלוֹם — שרשור על קפה ☕ עם X/טוויטר, ושורה שנייה'
}
export const LIMITS = { instructions: { bytes: 1024 }, tool: { chars: 600 }, prompt: { chars: 400 }, skill: { bytes: 8192 } }

/** Fences that are not deliberate, and more than one copy block, in one text. */
export function fenceProblems(text) {
  const lines = String(text).split('\n')
  const problems = []
  let open = null
  lines.forEach((line, i) => {
    const m = line.match(FENCE)
    if (!m) return
    if (open) {
      if (line.trim() === open) open = null
      return
    }
    open = m[1]
    if (!ALLOWED_BEFORE.some((re) => re.test(lines[i - 1] ?? ''))) problems.push(`a code fence at line ${i + 1} that is not the user-text fence or the copy block`)
  })
  if (lines.filter((line) => line === COPY_LABEL).length > 1) problems.push('more than one copy block')
  return problems
}

const tooLong = (text, limit) =>
  (limit.chars !== undefined && text.length > limit.chars) || (limit.bytes !== undefined && Buffer.byteLength(text) > limit.bytes)

/** Sample arguments for a prompt in one language: the free-text arguments get the sample, the others stay empty. */
function promptArgs(prompt, lang) {
  return Object.fromEntries(prompt.arguments.filter((a) => a.name === 'notes' || a.name === 'goal').map((a) => [a.name, SAMPLES[lang]]))
}

/**
 * The texts one client is sent, each as { group, name, text, limit, keep, server }: `keep` is user text that must come
 * back unchanged, `server` is true when the whole text is written by the server (so it must be clean server text).
 */
export function templatesFor(profile, server) {
  const reads = (field) => profile?.[field]?.value !== false
  const out = []
  if (reads('reads_instructions')) out.push({ group: 'instructions', name: 'instructions', text: server.instructions, limit: LIMITS.instructions, server: true })
  for (const tool of server.tools) out.push({ group: 'tools', name: tool.name, text: tool.description, limit: LIMITS.tool, server: true })
  if (reads('shows_prompts')) {
    for (const prompt of server.prompts) {
      out.push({ group: 'prompts', name: prompt.name, text: prompt.description, limit: LIMITS.prompt, server: true })
      for (const lang of Object.keys(SAMPLES)) {
        const args = promptArgs(prompt, lang)
        const built = server.getPrompt(prompt.name, args, { origin: 'https://app.example' })
        const text = built.result.messages.map((m) => m.content.text).join('\n')
        out.push({ group: 'prompts', name: `${prompt.name} (${lang} message)`, text, keep: Object.keys(args).length ? SAMPLES[lang] : undefined })
      }
    }
  }
  if (reads('reads_resources')) out.push({ group: 'skill', name: 'SKILL.md', text: server.skillText, limit: LIMITS.skill, server: true })
  // Every client gets tool results: the thread as markdown (#352), with each sample as a post.
  for (const [lang, sample] of Object.entries(SAMPLES)) {
    const text = server.threadText({ title: 'T', posts: [{ text: sample }, { text: sample }], url: 'https://app.example/draft/1', saved: true })
    out.push({ group: 'results', name: `thread markdown (${lang})`, text, keep: sample })
  }
  return out
}

/** Every problem for every client, and one table row per client and group. */
export function formatEval(clients, server) {
  const problems = []
  const rows = []
  for (const [client, profile] of Object.entries(clients.clients)) {
    const groups = {}
    for (const t of templatesFor(profile, server)) {
      const row = (groups[t.group] ??= { client, group: t.group, texts: 0, fence: 0, hebrew: 0, length: 0 })
      row.texts += 1
      const where = `${client} ${t.group} ${t.name}`
      const fences = fenceProblems(t.text)
      if (fences.length) problems.push(...fences.map((p) => `${where}: ${p}`))
      else row.fence += 1
      const hebrewOk = (t.keep === undefined || t.text.includes(t.keep)) && (!t.server || isCleanServerText(t.text))
      if (hebrewOk) row.hebrew += 1
      else problems.push(`${where}: Hebrew or user text is not kept exactly as written`)
      if (t.limit && tooLong(t.text, t.limit)) problems.push(`${where}: longer than ${JSON.stringify(t.limit)}`)
      else row.length += 1
    }
    rows.push(...Object.values(groups))
  }
  return { problems, rows }
}

/** The table: per client and group, how many texts pass each rule. */
export function formatEvalTable(rows) {
  const lines = ['client          group         texts fence hebrew length']
  for (const r of rows) {
    lines.push(`${r.client.padEnd(15)} ${r.group.padEnd(13)} ${String(r.texts).padEnd(5)} ${`${r.fence}/${r.texts}`.padEnd(5)} ${`${r.hebrew}/${r.texts}`.padEnd(6)} ${r.length}/${r.texts}`)
  }
  return lines.join('\n')
}
