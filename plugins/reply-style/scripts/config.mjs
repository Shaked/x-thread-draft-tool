#!/usr/bin/env node
// Project settings for the reply-style plugin, read from `.claude/agent-kit.json` in the project.
// A missing file or key means the default. A broken file throws ConfigError, which names the key and the file.
// Node 20, no dependencies. The only file read is in loadConfig; everything else is pure.
//
// Where the file is, in order: `file` when given; else $CLAUDE_PROJECT_DIR/.claude/agent-kit.json when that
// variable is set; else the first such file walking up from `cwd`, stopping at the folder that has `.git`.

import { readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

const RELATIVE = join('.claude', 'agent-kit.json')
const DEFAULT_OWNER = 'the owner'
const ALWAYS_HUMANS = ['you', 'your']
const DEFAULT_HUMANS = ['the owner']

export class ConfigError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ConfigError'
  }
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

function fail(key, file, want) {
  throw new ConfigError(`"${key}" in ${file} must be ${want}`)
}

function stringList(value, key, file) {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) fail(key, file, 'an array of strings')
  return [...value]
}

/** The file's text, or null when it is not there. Any other read error is a ConfigError. No check before the read. */
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

function checkAllowLines(patterns, file) {
  for (const pattern of patterns) {
    try {
      new RegExp(pattern)
    } catch {
      fail('reply-style.allowLines', file, `regular expressions (this one does not compile: "${pattern}")`)
    }
  }
  return patterns
}

function checkMaxLineLength(value, file) {
  if (value === undefined) return 160
  if (!Number.isInteger(value) || value <= 0) fail('reply-style.maxLineLength', file, 'a positive whole number')
  return value
}

function checkExtraTemplates(value, file) {
  if (value === undefined) return {}
  if (!isPlainObject(value) || !Object.values(value).every((v) => typeof v === 'string')) {
    fail('reply-style.extraTemplates', file, 'an object whose values are strings')
  }
  return { ...value }
}

/** The `reply-style` section: each key checked, or its default. */
function replyStyleSection(rs, owner, file) {
  // "you" and "your" always count: the fixed heading "Blocked on you" must pass whatever names a project adds.
  const listed = rs.humans === undefined ? DEFAULT_HUMANS : stringList(rs.humans, 'reply-style.humans', file)
  const humans = [...new Set([...ALWAYS_HUMANS, ...listed, ...(owner ? [owner] : [])])]
  return {
    humans,
    allowLines: checkAllowLines(rs.allowLines === undefined ? [] : stringList(rs.allowLines, 'reply-style.allowLines', file), file),
    maxLineLength: checkMaxLineLength(rs.maxLineLength, file),
    changelogAreas: rs.changelogAreas === undefined ? [] : stringList(rs.changelogAreas, 'reply-style.changelogAreas', file),
    extraTemplates: checkExtraTemplates(rs.extraTemplates, file),
    writingSkills: rs.writingSkills === undefined ? [] : stringList(rs.writingSkills, 'reply-style.writingSkills', file),
  }
}

/** Builds the settings from the parsed file. `file` is only used in messages. */
function buildConfig(raw, file = 'agent-kit.json') {
  if (!isPlainObject(raw)) throw new ConfigError(`${file} must hold a JSON object`)
  for (const key of ['owner', 'ownerLogin', 'repo']) {
    if (raw[key] !== undefined && typeof raw[key] !== 'string') fail(key, file, 'a string')
  }
  const rs = raw['reply-style'] === undefined ? {} : raw['reply-style']
  if (!isPlainObject(rs)) fail('reply-style', file, 'an object')
  return {
    owner: raw.owner ?? DEFAULT_OWNER,
    ownerLogin: raw.ownerLogin ?? '',
    repo: raw.repo ?? '',
    replyStyle: replyStyleSection(rs, raw.owner, file),
  }
}

function parseFile(text, file) {
  let raw
  try {
    raw = JSON.parse(text)
  } catch (error) {
    throw new ConfigError(`${file} is not valid JSON (${error.message})`)
  }
  return buildConfig(raw, file)
}

/** The settings as defaults: what loadConfig returns when there is no file. */
export const DEFAULT_CONFIG = buildConfig({})

/** Settings for one project. Reads one file at most; pass `env` in tests so the real environment is not used. */
export function loadConfig({ cwd = process.cwd(), env = process.env, file } = {}) {
  if (file) {
    const path = resolve(cwd, file)
    const text = readOptional(path)
    return text === null ? buildConfig({}) : parseFile(text, path)
  }
  if (env.CLAUDE_PROJECT_DIR) {
    const path = join(env.CLAUDE_PROJECT_DIR, RELATIVE)
    const text = readOptional(path)
    return text === null ? buildConfig({}) : parseFile(text, path)
  }
  let dir = resolve(cwd)
  for (;;) {
    const path = join(dir, RELATIVE)
    const text = readOptional(path)
    if (text !== null) return parseFile(text, path)
    const parent = dirname(dir)
    if (isGitRoot(dir) || parent === dir) return buildConfig({})
    dir = parent
  }
}
