// The contract format eval (docs/plans/draft-contract.md section 5.2, #395). Free and deterministic: no database, no
// network, no model. It builds every text a client is sent (the same server objects tests/api/mcp-discovery.test.js
// uses) and prints the table of tests/eval/discovery/format.mjs: per client profile and group, how many texts pass
// each rule. It checks nothing on its own and exits 0. The pass and fail rules are in tests/api/draft-contract.test.js
// and tests/api/mcp-discovery.test.js. Run with `npm run eval:contract`.
import { readFileSync } from 'node:fs'
import { listTools } from '../../../server/mcp/tools.js'
import { INSTRUCTIONS } from '../../../server/mcp/server.js'
import { getPrompt, listPrompts } from '../../../server/mcp/prompts.js'
import { readSkillResource } from '../../../server/mcp/skills.js'
import { threadText } from '../../../server/mcp/thread-text.js'
import { changeMeta, changesText } from '../../../server/mcp/edit-result.js'
import { formatEval, formatEvalTable } from '../discovery/format.mjs'

const clients = JSON.parse(readFileSync(new URL('../discovery/clients.json', import.meta.url), 'utf8'))
const server = {
  instructions: INSTRUCTIONS,
  tools: listTools(),
  prompts: listPrompts(),
  getPrompt,
  skillText: readSkillResource('skill://x-thread-drafts/SKILL.md')[0].text,
  threadText,
  editText: (before, after) => changesText(changeMeta(before, after))
}

const { problems, rows } = formatEval(clients, server)
console.log(formatEvalTable(rows))
console.log(problems.length ? `${problems.length} problem(s), each one a failing test in tests/api/mcp-discovery.test.js:` : 'no problems')
for (const problem of problems) console.log(`  ${problem}`)
