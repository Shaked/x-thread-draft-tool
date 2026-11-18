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

// The paste-in text for apps that only show a thread as text (docs/agents/mcp.md, section "Make your AI app save
// threads as drafts"). The tests check each text against that file, word for word, after joining its quoted lines.
export const PASTE_IN = {
  en: "When I ask you to write, draft or rewrite a thread or posts for X/Twitter, save it as a draft with the x-thread-draft-tool connector (create_thread_from_text) and give me the draft link. You can also show the posts as text. Do not mark a draft as published unless I ask.",
  he: "כשאני מבקש לכתוב, לנסח או לשכתב שרשור או ציוצים ל-X/טוויטר, שמור אותם כטיוטה דרך המחבר x-thread-draft-tool (create_thread_from_text) ותן לי את הקישור לטיוטה. אפשר להציג גם את הציוצים כטקסט. אל תסמן טיוטה כפורסמה בלי שאבקש."
}

// Where to paste the text, as in docs/agents/mcp.md.
export const PASTE_PLACES = [
  { name: 'ChatGPT', where: 'Settings, Personalization, Custom instructions; or the instructions of a project.' },
  { name: 'Claude', where: 'Settings, Profile, the personal preferences field; or the instructions of a project.' },
  { name: 'Claude Code', where: 'CLAUDE.md in the project, or ~/.claude/CLAUDE.md.' },
  { name: 'Codex', where: 'AGENTS.md in the project, or ~/.codex/AGENTS.md.' }
]
