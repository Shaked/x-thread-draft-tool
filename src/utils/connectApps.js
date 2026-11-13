// The four ways to connect an AI app to the MCP connector, shown on the Settings page (plan M10).
// Each entry says what to do and what to copy. The copy text is exact: the tests check it.
export function connectEntries(mcpUrl) {
  return [
    {
      id: 'claude',
      name: 'Claude',
      hint: 'In Settings, open Connectors, add a custom connector and paste the address.',
      copy: mcpUrl,
      copyLabel: 'Copy address'
    },
    {
      id: 'claude-code',
      name: 'Claude Code',
      hint: 'Run this in a terminal, then run /mcp in Claude Code and authenticate.',
      copy: `claude mcp add --transport http x-thread ${mcpUrl}`,
      copyLabel: 'Copy command'
    },
    {
      id: 'chatgpt',
      name: 'ChatGPT',
      hint: 'Turn on Developer mode, create a connector, paste the address and choose OAuth.',
      copy: mcpUrl,
      copyLabel: 'Copy address'
    },
    {
      id: 'codex',
      name: 'Codex CLI',
      hint: 'Run this in a terminal, then run codex mcp login x-thread.',
      copy: `codex mcp add x-thread --url ${mcpUrl}`,
      copyLabel: 'Copy command'
    }
  ]
}
