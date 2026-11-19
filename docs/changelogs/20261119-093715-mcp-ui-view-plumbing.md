# T1: MCP view plumbing and a thread view (dark, no tool uses it yet)

- The MCP server now lists and reads one `ui://` view, the thread view, next to the skill (`resources/list`, `resources/read`). Nothing sends it to a host yet: `tools/list` is unchanged, so this changes no tool result and no user-visible behaviour.
