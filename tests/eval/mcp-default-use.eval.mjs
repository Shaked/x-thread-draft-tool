// Plan docs/plans/mcp-default-use.md Task 3 (D3): an optional evaluation, not part of `npm test` or CI.
// It sends 12 prompts to the Anthropic Messages API with our MCP tool list and instructions, and checks
// which tools the model calls. No MCP connection and no account are needed. It measures how a Claude model
// chooses with our text; it does not measure ChatGPT, Grok or claude.ai, which add their own system prompt.
//
//   ANTHROPIC_API_KEY=... EVAL_MODEL=<model id> node tests/eval/mcp-default-use.eval.mjs
//
// A "before" run on old code needs the old INSTRUCTIONS text passed through the `load` parameter of main(),
// because INSTRUCTIONS was not exported before this PR.
// Without ANTHROPIC_API_KEY it prints "skipped: no key" and exits 0. The pure parts (prompts, request
// building, result checking, table) are unit tested offline in tests/unit/mcp-default-use-eval.test.js.
import { fileURLToPath } from 'node:url'

export const SAVE_TOOLS = ['create_thread_from_text', 'create_draft']
export const WRITE_TOOLS = [
  'create_thread_from_text', 'create_draft', 'add_post', 'update_post', 'update_draft',
  'duplicate_draft', 'delete_draft', 'publish_draft', 'move_post', 'remove_post', 'add_image_from_url', 'remove_image',
  'create_share_link', 'revoke_share_link'
]

// kind 'save': a written thread is asked for, a save tool should be called. kind 'question': no write tool.
export const PROMPTS = [
  { kind: 'save', lang: 'en', text: 'Write a thread about remote work' },
  { kind: 'save', lang: 'en', text: 'Write a thread about why I moved to Linux' },
  { kind: 'save', lang: 'en', text: 'Plan a 5-post X thread announcing my new newsletter about cooking' },
  { kind: 'save', lang: 'he', text: 'כתוב לי שרשור על AI' },
  { kind: 'save', lang: 'he', text: 'כתוב לי שרשור על קפה' },
  { kind: 'save', lang: 'he', text: 'תכתוב לי ציוצים על ההשקה של המוצר שלנו' },
  { kind: 'question', lang: 'en', text: 'How long can a tweet be?' },
  { kind: 'question', lang: 'en', text: 'What makes a good thread hook?' },
  { kind: 'question', lang: 'en', text: 'Is it better to post threads in the morning or the evening?' },
  { kind: 'question', lang: 'he', text: 'מה זה שרשור?' },
  { kind: 'question', lang: 'he', text: 'מה האורך המקסימלי של ציוץ?' },
  { kind: 'question', lang: 'he', text: 'איך כותבים פתיחה טובה לשרשור?' }
]

/** The Messages API request for one prompt. `tools` come from listTools(), `instructions` is the system text. */
export function buildRequest({ model, instructions, tools, prompt }) {
  return {
    model,
    max_tokens: 1024,
    system: instructions,
    tools: tools.map(({ name, description, inputSchema }) => ({ name, description, input_schema: inputSchema })),
    messages: [{ role: 'user', content: prompt.text }]
  }
}

/** Names of the tools the model asked to call in a Messages API response. */
export function calledTools(response) {
  return (response?.content ?? []).filter((block) => block.type === 'tool_use').map((block) => block.name)
}

/** True when the prompt behaved as the plan expects: save prompts call a save tool, questions call no write tool. */
export function isExpected(prompt, called) {
  if (prompt.kind === 'save') return called.some((name) => SAVE_TOOLS.includes(name))
  return !called.some((name) => WRITE_TOOLS.includes(name))
}

const pct = (n, d) => (d === 0 ? 0 : Math.round((n / d) * 100))

/** The two numbers: share of save prompts that called a save tool, share of question prompts that called a write tool. */
export function summarize(results) {
  const save = results.filter((r) => r.prompt.kind === 'save')
  const question = results.filter((r) => r.prompt.kind === 'question')
  const saved = save.filter((r) => r.called.some((name) => SAVE_TOOLS.includes(name))).length
  const wrote = question.filter((r) => r.called.some((name) => WRITE_TOOLS.includes(name))).length
  return {
    savePct: pct(saved, save.length),
    questionWritePct: pct(wrote, question.length),
    saved, saveTotal: save.length, wrote, questionTotal: question.length
  }
}

export function formatTable(results) {
  const rows = results.map((r) => `| ${r.prompt.kind} | ${r.prompt.lang} | ${r.prompt.text} | ${r.called.join(', ') || '-'} | ${isExpected(r.prompt, r.called) ? 'ok' : 'MISS'} |`)
  const s = summarize(results)
  return [
    '| kind | lang | prompt | tools called | result |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
    '',
    `save prompts that called a save tool: ${s.savePct}% (${s.saved}/${s.saveTotal})`,
    `question prompts that called a write tool: ${s.questionWritePct}% (${s.wrote}/${s.questionTotal})`
  ].join('\n')
}

async function callApi(body, apiKey) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error(`Anthropic API ${res.status}`)
  return res.json()
}

/** Runs the evaluation. Returns the process exit code. `call` is injectable for tests. */
export async function main({ env = process.env, log = console.log, call = callApi, load } = {}) {
  const apiKey = env.ANTHROPIC_API_KEY
  if (!apiKey) {
    log('skipped: no key (set ANTHROPIC_API_KEY and EVAL_MODEL to run this evaluation)')
    return 0
  }
  const model = env.EVAL_MODEL
  if (!model) {
    log('skipped: no model (set EVAL_MODEL to a Claude model id)')
    return 0
  }
  const { instructions, tools } = await (load ?? loadServerText)()
  const results = []
  for (const prompt of PROMPTS) {
    const response = await call(buildRequest({ model, instructions, tools, prompt }), apiKey)
    results.push({ prompt, called: calledTools(response) })
  }
  log(formatTable(results))
  return 0
}

async function loadServerText() {
  const [{ INSTRUCTIONS }, { listTools }] = await Promise.all([import('../../server/mcp/server.js'), import('../../server/mcp/tools.js')])
  return { instructions: INSTRUCTIONS, tools: listTools() }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then((code) => process.exit(code), (err) => { console.error(err.message); process.exit(1) })
}
