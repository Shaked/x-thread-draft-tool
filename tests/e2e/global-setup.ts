// Playwright global setup (#177): bundles the official AppBridge host for tests/e2e/mcp-ui.spec.ts into
// tests/e2e/.generated/app-bridge.js (gitignored). Test-only: the app bundle does not change.
import { join } from 'node:path'
import { build } from 'vite'

export default async function globalSetup() {
  const root = process.cwd()
  await build({
    configFile: false,
    logLevel: 'warn',
    build: {
      outDir: join(root, 'tests/e2e/.generated'),
      emptyOutDir: true,
      publicDir: false,
      minify: false,
      lib: {
        entry: join(root, 'tests/e2e/fixtures/app-bridge-entry.js'),
        formats: ['iife'],
        name: 'ExtAppsHost',
        fileName: () => 'app-bridge.js'
      }
    }
  })
}
