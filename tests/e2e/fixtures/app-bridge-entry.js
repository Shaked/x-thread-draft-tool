// Test-only entry (#177, first commit): the OFFICIAL AppBridge and PostMessageTransport from @modelcontextprotocol/ext-apps.
// tests/e2e/global-setup.ts bundles it to tests/e2e/.generated/app-bridge.js (gitignored). It is never part of the app.
export { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge'
