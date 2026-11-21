// @vitest-environment node
// Implements #273 Task C1 (issue #365): docs/architecture/client-matrix.md has a cell for every client in
// tests/eval/discovery/clients.json and every supported language, and the client-facing text has English and Hebrew
// for the same key. No model, no network, no database.
import { describe, expect, it } from 'vitest'
import { listTools } from '../../server/mcp/tools.js'
import { listAdminTools } from '../../server/mcp/admin-tools.js'
import { listPrompts } from '../../server/mcp/prompts.js'
import { listSkillResources } from '../../server/mcp/skills.js'
import { listUiResources } from '../../server/mcp/ui/index.js'
import { INSTRUCTIONS } from '../../server/mcp/server.js'
import { checkMatrix, languageProblems, loadMatrix, parseMatrix, staleNotChecked } from '../eval/client-matrix.mjs'

const views = listUiResources().map((r) => r.name)
const real = () => ({ ...loadMatrix(), views })
/** The client-facing texts that carry an English and a Hebrew part. */
const texts = () => [
  { key: 'instructions', text: INSTRUCTIONS, kind: 'mixed' },
  { key: 'skill description', text: listSkillResources()[0].description, kind: 'mixed' },
  ...[...listTools(), ...listAdminTools()].map((t) => ({ key: `tool ${t.name}`, text: t.description, kind: 'pair' })),
  ...listPrompts().map((p) => ({ key: `prompt ${p.name}`, text: p.description, kind: 'pair' }))
]
/** The real matrix with one cell replaced: row `feature` of table `lang`, column index `col`. */
function withCell(input, lang, feature, col, value) {
  const row = input.tables[`Language: ${lang}`].rows.find((r) => r[0] === feature)
  row[col] = value
  return input
}

describe('client matrix (docs/architecture/client-matrix.md)', () => {
  it('has every client and language, a valid cell everywhere, and no claim that clients.json does not back', () => {
    expect(checkMatrix(real())).toEqual([])
  })

  it('has English and Hebrew for every tool, prompt, the instructions and the skill description', () => {
    expect(languageProblems(texts())).toEqual([])
  })

  it('fails for a new client or language with no column, and for a missing row or cell', () => {
    const input = real()
    input.clients = { ...input.clients, languages: [...input.clients.languages, 'ar'], clients: { ...input.clients.clients, le_chat: {} } }
    input.tables['Language: he'].rows.pop()
    input.tables['Language: en'].rows[0].pop()
    const problems = checkMatrix(input).join('\n')
    expect(problems).toContain('no table "## Language: ar"')
    expect(problems).toContain('en: no column for the client le_chat')
    expect(problems).toContain('he: feature row is missing: Connect guide')
    expect(problems).toContain('en Server instructions: has 8 cells, the header has 9')
  })

  it('fails for a short "no:", a file that does not exist, a bad cell and an unbacked "built"', () => {
    let input = withCell(real(), 'he', 'Skill', 2, 'no: later')
    input = withCell(input, 'en', 'Skill', 1, 'built: tests/api/ghost.test.js')
    input = withCell(input, 'en', 'Thread view', 3, 'yes')
    input = withCell(input, 'he', 'Server instructions', 5, 'built: tests/api/mcp-default-use.test.js')
    const problems = checkMatrix(input).join('\n')
    expect(problems).toContain('he Skill claude_ai: the "no:" reason needs at least 3 words')
    expect(problems).toContain('en Skill Server: built names a file that does not exist: tests/api/ghost.test.js')
    expect(problems).toContain('en Thread view claude_desktop: cell must be')
    expect(problems).toContain('he Server instructions grok: clients.json says "not checked"')
  })

  it('fails for a view with no row, and finds stale "not checked" rows', () => {
    const input = real()
    input.views = [...views, 'poll']
    expect(checkMatrix(input).join('\n')).toContain('no feature row covers view:poll')
    const tables = parseMatrix('## Features\n| Feature | Covers | Needs | Checked |\n|---|---|---|---|\n| A | tools | none | 2026-01-01 |\n' +
      '## Language: en\n| Feature | Server | grok |\n|---|---|---|\n| A | built: x | not checked |\n')
    expect(staleNotChecked(tables, '2026-03-01')).toEqual([{ feature: 'A', lang: 'en', checked: '2026-01-01', clients: ['grok'] }])
    expect(staleNotChecked(tables, '2026-01-20')).toEqual([])
  })

  it('fails for English without Hebrew, Hebrew without English, and an untranslated word in Hebrew', () => {
    const problems = languageProblems([
      { key: 'tool a', text: 'Do a. Also: new thing, on X/Twitter. Hebrew:  (X/טוויטר).', kind: 'pair' },
      { key: 'tool b', text: 'Do b. Also: שרשור. Hebrew: שרשור (X/טוויטר).', kind: 'pair' },
      { key: 'tool c', text: 'Do c. Also: draft. Hebrew: לפתוח draft_id בטוויטר (X/טוויטר).', kind: 'pair' },
      { key: 'prompt d', text: 'Only English here.', kind: 'pair' },
      { key: 'instructions', text: 'Only English here.', kind: 'mixed' }
    ]).join('\n')
    expect(problems).toContain('tool a: English text has no Hebrew counterpart')
    expect(problems).toContain('tool b: Hebrew text has no English counterpart')
    expect(problems).toContain('tool c: Hebrew part has untranslated Latin words: draft_id')
    expect(problems).toContain('prompt d: no "Also: <English>. Hebrew: <Hebrew>." part')
    expect(problems).toContain('instructions: English text has no Hebrew counterpart')
  })
})
