// @vitest-environment node
// Offline part of the optional D3 evaluation (tests/eval/mcp-default-use.eval.mjs). No API call is made.
import { describe, expect, it, vi } from 'vitest'
import { listTools } from '../../server/mcp/tools.js'
import { PROMPTS, WRITE_TOOLS, buildRequest, calledTools, formatTable, isExpected, main, summarize } from '../eval/mcp-default-use.eval.mjs'

const tools = [{ name: 'create_draft', description: 'd', inputSchema: { type: 'object' } }]

describe('mcp default-use eval', () => {
  it('has 12 prompts: 6 save and 6 question, half Hebrew', () => {
    expect(PROMPTS).toHaveLength(12)
    expect(PROMPTS.filter((p) => p.kind === 'save')).toHaveLength(6)
    expect(PROMPTS.filter((p) => p.lang === 'he')).toHaveLength(6)
    expect(PROMPTS.filter((p) => p.kind === 'save' && p.lang === 'he')).toHaveLength(3)
  })

  it('WRITE_TOOLS equals the non-read-only tools of the real tool list', () => {
    const real = listTools().filter((t) => t.annotations?.readOnlyHint === false).map((t) => t.name)
    expect([...WRITE_TOOLS].sort()).toEqual(real.sort())
  })

  it('no save prompt names drafts', () => {
    for (const p of PROMPTS.filter((x) => x.kind === 'save')) expect(p.text).not.toMatch(/draft|טיוטה/i)
  })

  it('builds a Messages API request with the instructions as system text', () => {
    const req = buildRequest({ model: 'm', instructions: 'INS', tools, prompt: PROMPTS[0] })
    expect(req.system).toBe('INS')
    expect(req.tools[0]).toEqual({ name: 'create_draft', description: 'd', input_schema: { type: 'object' } })
    expect(req.messages).toEqual([{ role: 'user', content: PROMPTS[0].text }])
  })

  it('reads tool names and checks expectations', () => {
    expect(calledTools({ content: [{ type: 'text', text: 'x' }, { type: 'tool_use', name: 'create_draft' }] })).toEqual(['create_draft'])
    expect(calledTools({})).toEqual([])
    expect(isExpected({ kind: 'save' }, ['create_thread_from_text'])).toBe(true)
    expect(isExpected({ kind: 'save' }, [])).toBe(false)
    expect(isExpected({ kind: 'question' }, [])).toBe(true)
    expect(isExpected({ kind: 'question' }, ['create_draft'])).toBe(false)
    expect(isExpected({ kind: 'question' }, ['list_drafts'])).toBe(true)
  })

  it('computes the two shares and the table', () => {
    const results = PROMPTS.map((prompt, i) => ({ prompt, called: prompt.kind === 'save' ? (i < 3 ? ['create_draft'] : []) : (i === 6 ? ['create_draft'] : []) }))
    expect(summarize(results)).toMatchObject({ savePct: 50, questionWritePct: 17 })
    expect(formatTable(results)).toContain('save prompts that called a save tool: 50% (3/6)')
  })

  it('skips cleanly without a key and calls nothing', async () => {
    const log = vi.fn()
    const call = vi.fn()
    expect(await main({ env: {}, log, call })).toBe(0)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('skipped: no key'))
    expect(call).not.toHaveBeenCalled()
  })

  it('runs all prompts with an injected client', async () => {
    const log = vi.fn()
    const call = vi.fn(async () => ({ content: [{ type: 'tool_use', name: 'create_draft' }] }))
    const load = async () => ({ instructions: 'INS', tools })
    expect(await main({ env: { ANTHROPIC_API_KEY: 'k', EVAL_MODEL: 'm' }, log, call, load })).toBe(0)
    expect(call).toHaveBeenCalledTimes(12)
    expect(log.mock.calls[0][0]).toContain('question prompts that called a write tool: 100%')
  })
})
