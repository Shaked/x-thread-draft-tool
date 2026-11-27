#!/usr/bin/env node
// Installs every plugin of this marketplace with the Claude Code CLI and checks what the CLI reports: enabled, the
// manifest version, and the components the plugin ships. Needs `claude` on the PATH and an empty CLAUDE_CONFIG_DIR.
// No model call, no login. Used by .github/workflows/plugin-cli.yml (docs/plans/plugin-marketplace.md, test 8).
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'

const root = process.cwd()
const claude = (...args) => execFileSync('claude', args, { encoding: 'utf8', cwd: root })
const market = JSON.parse(readFileSync('.claude-plugin/marketplace.json', 'utf8'))
const failures = []

for (const entry of market.plugins) {
  const manifest = JSON.parse(readFileSync(`plugins/${entry.name}/.claude-plugin/plugin.json`, 'utf8'))
  claude('plugin', 'install', entry.name, '--marketplace', root, '--scope', 'user')
  const listed = JSON.parse(claude('plugin', 'list', '--json')).find((p) => String(p.id ?? p.name).startsWith(`${entry.name}@`))
  if (!listed) failures.push(`${entry.name}: not in "claude plugin list"`)
  else {
    if (listed.enabled !== true) failures.push(`${entry.name}: not enabled`)
    if (listed.version !== manifest.version) failures.push(`${entry.name}: CLI version ${listed.version}, manifest ${manifest.version}`)
  }
  const details = claude('plugin', 'details', `${entry.name}@${market.name}`)
  // The CLI lists each command as a skill too (plugin task-janitor: Skills (3) for one skill and two commands).
  const commands = existsSync(`plugins/${entry.name}/commands`) ? readdirSync(`plugins/${entry.name}/commands`).filter((f) => f.endsWith('.md')).length : 0
  const skills = readdirSync(`plugins/${entry.name}/skills`, { withFileTypes: true }).filter((d) => d.isDirectory()).length + commands
  if (!new RegExp(`Skills \\(${skills}\\)`).test(details)) failures.push(`${entry.name}: the CLI does not list ${skills} skill(s)`)
  const hooksFile = `plugins/${entry.name}/hooks/hooks.json`
  const hooks = existsSync(hooksFile) ? JSON.parse(readFileSync(hooksFile, 'utf8')).hooks ?? {} : {}
  for (const event of Object.keys(hooks)) if (!details.includes(event)) failures.push(`${entry.name}: the CLI does not list the ${event} hook`)
}

for (const f of failures) console.log(f)
console.log(failures.length ? `plugin-cli-check: ${failures.length} problem(s)` : `plugin-cli-check: ${market.plugins.length} plugin(s) OK`)
if (failures.length) process.exit(1)
