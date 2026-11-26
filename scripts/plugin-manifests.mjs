#!/usr/bin/env node
// Plugin manifest rules (docs/plans/plugin-marketplace.md, sections 4.1, 4.5 and test plan 1 and 2).
// checkManifests: the marketplace and each plugin's manifest, files and version.
// forbiddenStrings: words that must not appear in plugins/ or .claude-plugin/.
// versionBumps: a changed plugin must change its version (--bumps, against origin/main).
//
// Usage: node scripts/plugin-manifests.mjs            (manifests and forbidden strings)
//        node scripts/plugin-manifests.mjs --bumps    (version bumps, git diff origin/main...HEAD)

import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const MARKETPLACE = '.claude-plugin/marketplace.json'
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/
const RESERVED_PREFIXES = ['claude-', 'anthropic-', 'anthropics-', 'cc-plugin-']
const ALLOWED_HASH_NUMBERS = new Set(['#12', '#34'])
const EXEMPT_JSON_PATHS = [['owner', 'name'], ['author', 'name']]

const FORBIDDEN_WORDS = [
  { text: 'x-thread-draft-tool', re: /x-thread-draft-tool/g },
  { text: 'Shaked', re: /\bShaked\b/g },
  { text: 'thread draft', re: /thread draft/gi },
  { text: 'docs/plans/', re: /docs\/plans\//g },
  { text: 'docs/operations/', re: /docs\/operations\//g },
  { text: 'XT_', re: /XT_/g },
  { text: '#<digits>', re: /#\d+/g },
]

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const isText = (value) => typeof value === 'string' && value.trim() !== ''

/** The file's bytes, or null when it is missing or a folder. One read, no check before it (no race). */
function readBytes(root, path) {
  try {
    return readFileSync(join(root, path))
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR' || error.code === 'ENOTDIR') return null
    throw error
  }
}

function readText(root, path) {
  const bytes = readBytes(root, path)
  return bytes === null ? null : bytes.toString('utf8')
}

function parseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (error) {
    return { ok: false, error: error.message }
  }
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** Manifest, file and version problems for the marketplace and every plugin it lists. */
export function checkManifests(root) {
  const problems = []
  const add = (file, message) => problems.push({ file, message })
  const market = readMarketplace(root, add)
  if (market === null) return problems
  const rootLicense = readBytes(root, 'LICENSE')
  for (const entry of market.plugins) checkEntry(root, entry, rootLicense, add)
  return problems
}

function readMarketplace(root, add) {
  const text = readText(root, MARKETPLACE)
  if (text === null) {
    add(MARKETPLACE, 'marketplace.json is missing')
    return null
  }
  const parsed = parseJson(text)
  if (!parsed.ok) {
    add(MARKETPLACE, `marketplace.json is not valid JSON (${parsed.error})`)
    return null
  }
  const market = parsed.value
  if (!isObject(market)) {
    add(MARKETPLACE, 'marketplace.json must be a JSON object')
    return null
  }
  if (!isText(market.name)) add(MARKETPLACE, 'marketplace name is missing')
  if (!isObject(market.owner) || !isText(market.owner.name)) add(MARKETPLACE, 'marketplace owner.name is missing')
  if (!isText(market.description)) add(MARKETPLACE, 'marketplace description is missing')
  if (!Array.isArray(market.plugins)) {
    add(MARKETPLACE, 'marketplace plugins must be an array')
    return null
  }
  return market
}

function checkEntry(root, entry, rootLicense, add) {
  if (!isObject(entry)) {
    add(MARKETPLACE, 'a plugin entry is not an object')
    return
  }
  checkEntryName(entry.name, add)
  const dir = pluginDir(root, entry, add)
  if (dir === null) return
  const manifestPath = `${dir}/.claude-plugin/plugin.json`
  const plugin = readPluginManifest(root, manifestPath, add)
  if (plugin === null) return
  checkPluginFields(plugin, entry, manifestPath, add)
  checkPluginFiles(root, dir, plugin.version, add)
  checkPluginLicense(root, dir, rootLicense, add)
}

function checkEntryName(name, add) {
  if (typeof name !== 'string' || !KEBAB.test(name)) {
    add(MARKETPLACE, `plugin name "${name}" is not kebab-case`)
  } else if (RESERVED_PREFIXES.some((prefix) => name.startsWith(prefix))) {
    add(MARKETPLACE, `plugin name "${name}" uses a reserved prefix`)
  }
}

/** The plugin folder relative to the root, or null after adding a problem. */
function pluginDir(root, entry, add) {
  const source = entry.source
  if (typeof source !== 'string' || !source.startsWith('./') || source.includes('..')) {
    add(MARKETPLACE, `plugin "${entry.name}" source must start with "./" and must not contain ".."`)
    return null
  }
  const dir = source.replace(/^\.\//, '').replace(/\/+$/, '')
  if (!isDirectory(join(root, dir))) {
    add(MARKETPLACE, `plugin "${entry.name}" source "${source}" is not an existing folder`)
    return null
  }
  return dir
}

function readPluginManifest(root, manifestPath, add) {
  const text = readText(root, manifestPath)
  if (text === null) {
    add(manifestPath, 'plugin.json is missing')
    return null
  }
  const parsed = parseJson(text)
  if (!parsed.ok) {
    add(manifestPath, `plugin.json is not valid JSON (${parsed.error})`)
    return null
  }
  if (!isObject(parsed.value)) {
    add(manifestPath, 'plugin.json must be a JSON object')
    return null
  }
  return parsed.value
}

function checkPluginFields(plugin, entry, manifestPath, add) {
  if (plugin.name !== entry.name) {
    add(manifestPath, `plugin name "${plugin.name}" does not match marketplace entry "${entry.name}"`)
  }
  if (!isText(entry.version) || plugin.version !== entry.version) {
    add(manifestPath, `version "${plugin.version}" does not match marketplace entry version "${entry.version}"`)
  }
  if (!isText(plugin.description)) add(manifestPath, 'plugin description is missing')
  if (!isObject(plugin.author) || !isText(plugin.author.name)) add(manifestPath, 'plugin author.name is missing')
  if (!isObject(plugin.network) || !Array.isArray(plugin.network.hosts)) {
    add(manifestPath, 'plugin network.hosts must be an array')
  }
}

function checkPluginFiles(root, dir, version, add) {
  if (readText(root, `${dir}/README.md`) === null) add(`${dir}/README.md`, 'README.md is missing')
  const changelog = readText(root, `${dir}/CHANGELOG.md`)
  if (changelog === null) {
    add(`${dir}/CHANGELOG.md`, 'CHANGELOG.md is missing')
  } else if (!changelog.split('\n').some((line) => line.trim() === `## ${version}`)) {
    add(`${dir}/CHANGELOG.md`, `CHANGELOG.md has no section "## ${version}"`)
  }
}

function checkPluginLicense(root, dir, rootLicense, add) {
  if (rootLicense === null) return
  const pluginLicense = readBytes(root, `${dir}/LICENSE`)
  if (pluginLicense === null) {
    add(`${dir}/LICENSE`, 'LICENSE is missing (the root LICENSE exists)')
  } else if (!pluginLicense.equals(rootLicense)) {
    add(`${dir}/LICENSE`, 'LICENSE does not equal the root LICENSE')
  }
}

/** Forbidden words found in one file's text. JSON manifests skip owner.name and author.name. */
export function findForbidden(file, text, isJsonManifest = false) {
  const found = []
  const scanValue = (value, line) => {
    for (const word of FORBIDDEN_WORDS) {
      for (const match of value.matchAll(word.re)) {
        if (ALLOWED_HASH_NUMBERS.has(match[0])) continue
        found.push({ file, line, match: match[0] })
      }
    }
  }

  const parsed = isJsonManifest ? parseJson(text) : { ok: false }
  if (!parsed.ok) {
    text.split('\n').forEach((lineText, index) => scanValue(lineText, index + 1))
    return found
  }

  const lines = text.split('\n')
  const walk = (node, path) => {
    if (typeof node === 'string') {
      if (isExemptPath(path)) return
      const needle = JSON.stringify(node).slice(1, -1)
      const lineIndex = lines.findIndex((lineText) => lineText.includes(needle))
      scanValue(node, lineIndex + 1)
      return
    }
    if (Array.isArray(node)) node.forEach((item, i) => walk(item, [...path, i]))
    else if (isObject(node)) for (const [key, value] of Object.entries(node)) walk(value, [...path, key])
  }
  walk(parsed.value, [])
  return found
}

function isExemptPath(path) {
  return EXEMPT_JSON_PATHS.some((exempt) => exempt.length === path.length && exempt.every((key, i) => key === path[i]))
}

function listFiles(dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...listFiles(full))
    else if (entry.isFile()) files.push(full)
  }
  return files
}

/** Forbidden words in every file under plugins/ and .claude-plugin/ (a LICENSE file one level under plugins/ is exempt). */
export function forbiddenStrings(root) {
  const problems = []
  const dirs = [join(root, 'plugins'), join(root, '.claude-plugin')].filter(isDirectory)
  for (const dir of dirs) {
    for (const full of listFiles(dir).sort()) {
      const rel = relative(root, full).split(sep).join('/')
      if (/^plugins\/[^/]+\/LICENSE$/.test(rel)) continue
      const text = readFileSync(full, 'utf8')
      const isJsonManifest = /(^|\/)\.claude-plugin\/.*\.json$/.test(rel)
      problems.push(...findForbidden(rel, text, isJsonManifest))
    }
  }
  return problems
}

/** A changed plugin folder must have a new version in its plugin.json. A new plugin (no old manifest) passes. */
export function versionBumps(changedFiles, readOld, readNew) {
  const plugins = new Set()
  for (const file of changedFiles) {
    const match = /^plugins\/([^/]+)\//.exec(file)
    if (match) plugins.add(match[1])
  }
  const problems = []
  for (const plugin of [...plugins].sort()) {
    const manifestPath = `plugins/${plugin}/.claude-plugin/plugin.json`
    const oldText = readOld(manifestPath)
    if (oldText === null) continue
    const oldVersion = versionOf(oldText)
    const newVersion = versionOf(readNew(manifestPath))
    if (oldVersion === newVersion) {
      problems.push({
        plugin,
        message: `plugins/${plugin} changed but its version is still ${newVersion}; bump plugin.json and add a CHANGELOG section`,
      })
    }
  }
  return problems
}

function versionOf(text) {
  if (text === null || text === undefined) return undefined
  const parsed = parseJson(text)
  return parsed.ok && isObject(parsed.value) ? parsed.value.version : undefined
}

function gitText(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function gitShow(root, ref, path) {
  try {
    return gitText(root, ['show', `${ref}:${path}`])
  } catch {
    return null
  }
}

function main(argv) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const bumps = argv.includes('--bumps')
  let problems
  if (bumps) {
    const changed = gitText(root, ['diff', '--name-only', 'origin/main...HEAD']).split('\n').filter(Boolean)
    problems = versionBumps(
      changed,
      (path) => gitShow(root, 'origin/main', path),
      (path) => gitShow(root, 'HEAD', path),
    ).map((p) => p.message)
  } else {
    problems = [
      ...checkManifests(root).map((p) => `${p.file}: ${p.message}`),
      ...forbiddenStrings(root).map((p) => `${p.file}:${p.line}: forbidden "${p.match}"`),
    ]
  }
  if (problems.length > 0) {
    for (const line of problems) console.error(line)
    process.exit(1)
  }
  console.log(bumps ? 'plugin-manifests: version bumps OK' : 'plugin-manifests: OK')
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2))
