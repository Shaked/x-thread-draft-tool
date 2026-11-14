// Shared by the MCP tests that validate results against the vendored official JSON Schemas
// (tests/api/fixtures/mcp-schema/<version>.schema.json). The files have no $id, so each is
// registered under its own key. No network; strict mode is off for the spec files only.
import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import { expect } from 'vitest'

const ajv = new Ajv2020({ strict: false, allErrors: true })
addFormats(ajv)
for (const version of ['2026-07-28', '2025-11-25']) {
  const file = new URL(`../fixtures/mcp-schema/${version}.schema.json`, import.meta.url)
  ajv.addSchema(JSON.parse(readFileSync(file, 'utf8')), `mcp-${version}`)
}

/** Fails with every Ajv error (def, instancePath, message) when `value` is not a valid `def`. */
export function expectValid(version, def, value) {
  const validate = ajv.getSchema(`mcp-${version}#/$defs/${def}`)
  if (!validate) throw new Error(`no ${def} in the ${version} schema`)
  const ok = validate(value)
  const errors = (validate.errors ?? []).map((e) => `${def} ${e.instancePath || '/'}: ${e.message}`)
  expect(errors, JSON.stringify(value)).toEqual([])
  expect(ok).toBe(true)
}
