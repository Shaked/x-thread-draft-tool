#!/usr/bin/env node
// Project settings for the metrics plugin: the `metrics` section of `.claude/agent-kit.json` in the project.
// Four values: app, repo, siteUrl, ingestUrl. Node 20, no dependencies. The only file read is in loadMetricsConfig.
//
// Where the file is, in order: `file` when given; else $CLAUDE_PROJECT_DIR/.claude/agent-kit.json when that variable
// is set; else the first such file walking up from `cwd`, stopping at the folder that has `.git`.
// Command line: `node metrics-config.mjs [--config <file>]` prints the four values. Exit 0 when all are set,
// 1 when a value is missing (the output says which), 2 when the file is broken (the output names the key).

import { readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const RELATIVE = join('.claude', 'agent-kit.json')
const KEYS = ['app', 'repo', 'siteUrl', 'ingestUrl']
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

export class ConfigError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ConfigError'
  }
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

function readOptional(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null
    throw new ConfigError(`${path} cannot be read (${error.code || error.message})`)
  }
}

function isGitRoot(dir) {
  try {
    statSync(join(dir, '.git'))
    return true
  } catch {
    return false
  }
}

function checkUrl(value, key, file) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new ConfigError(`"metrics.${key}" in ${file} must be an https address (this is not an address: "${value}")`)
  }
  if (url.protocol !== 'https:') throw new ConfigError(`"metrics.${key}" in ${file} must start with https://`)
  return value
}

/** The four values from a parsed file. A missing value is the empty string. `repo` falls back to the top-level `repo`. */
export function buildMetricsConfig(raw, file = 'agent-kit.json') {
  if (!isPlainObject(raw)) throw new ConfigError(`${file} must hold a JSON object`)
  const section = raw.metrics === undefined ? {} : raw.metrics
  if (!isPlainObject(section)) throw new ConfigError(`"metrics" in ${file} must be an object`)
  for (const key of KEYS) {
    if (section[key] !== undefined && (typeof section[key] !== 'string' || section[key].trim() === '')) {
      throw new ConfigError(`"metrics.${key}" in ${file} must be a non-empty string`)
    }
  }
  const repo = section.repo ?? (typeof raw.repo === 'string' ? raw.repo : '')
  if (repo !== '' && !REPO.test(repo)) throw new ConfigError(`"metrics.repo" in ${file} must look like owner/name (this is "${repo}")`)
  return {
    app: section.app ?? '',
    repo,
    siteUrl: section.siteUrl === undefined ? '' : checkUrl(section.siteUrl, 'siteUrl', file),
    ingestUrl: section.ingestUrl === undefined ? '' : checkUrl(section.ingestUrl, 'ingestUrl', file)
  }
}

function parseFile(text, file) {
  let raw
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new ConfigError(`${file} is not valid JSON (${error.message})`)
  }
  return buildMetricsConfig(raw, file)
}

/** The settings for one project. No file means every value is empty. Pass `env` in tests. */
export function loadMetricsConfig({ cwd = process.cwd(), env = process.env, file } = {}) {
  if (file) {
    const path = resolve(cwd, file)
    const text = readOptional(path)
    if (text === null) throw new ConfigError(`${path} does not exist (named with --config)`)
    return parseFile(text, path)
  }
  if (env.CLAUDE_PROJECT_DIR) {
    const text = readOptional(join(env.CLAUDE_PROJECT_DIR, RELATIVE))
    return text === null ? buildMetricsConfig({}) : parseFile(text, join(env.CLAUDE_PROJECT_DIR, RELATIVE))
  }
  let dir = resolve(cwd)
  for (;;) {
    const path = join(dir, RELATIVE)
    const text = readOptional(path)
    if (text !== null) return parseFile(text, path)
    const parent = dirname(dir)
    if (isGitRoot(dir) || parent === dir) return buildMetricsConfig({})
    dir = parent
  }
}

/** The names of the values that are not set. */
export const missingKeys = (config) => KEYS.filter((key) => config[key] === '')

export function main(argv = process.argv.slice(2), { cwd = process.cwd(), env = process.env } = {}) {
  let file
  if (argv[0] === '--config') {
    file = argv[1]
    if (!file) {
      console.error('metrics-config: --config needs a file')
      return 2
    }
  } else if (argv.length > 0) {
    console.error(`metrics-config: unknown option ${argv[0]}`)
    return 2
  }
  let config
  try {
    config = loadMetricsConfig({ cwd, env, file })
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error
    console.error(`metrics-config: ${error.message}`)
    return 2
  }
  for (const key of KEYS) console.log(`${key}: ${config[key] === '' ? '(not set)' : config[key]}`)
  const missing = missingKeys(config)
  if (missing.length > 0) {
    console.log(`Set ${missing.map((key) => `metrics.${key}`).join(', ')} in .claude/agent-kit.json.`)
    return 1
  }
  return 0
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) process.exit(main())
