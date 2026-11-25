# Client and language matrix

Every feature that an AI app or an assistant sees or uses, for every supported AI app (client) and both languages. Rule in `AGENTS.md`: a change to one of these features covers every client and both languages in the same PR, or the cell says why not.

`tests/api/client-matrix.test.js` reads the tables below. No model and no network. It fails when:
- a client in `tests/eval/discovery/clients.json` has no column, or a language in its `languages` list has no table;
- a feature row or a cell is missing, or a cell is not one of the three forms below;
- a `built:` cell names a file that does not exist, or a `no:` reason has fewer than 3 words;
- a cell says `built` while `clients.json` says `not checked` (or `false`) for what the feature needs;
- a served view (`view:<name>`) or a surface (instructions, tools, results, prompts, skill) has no row;
- a tool or prompt description has an English trigger part without a Hebrew one, or the reverse, or Latin words left in the Hebrew part (product names such as X and Twitter are allowed).

## Cell forms

- `built: <file>[, <file>]`: done for this client and language. Each file is a test or file in this repo that proves the server side. For a client column it also means the client fact in the row's Needs column is `true` in `clients.json`, with a source (a page, or an issue that records what Shaked saw). It is not a claim that anyone watched this exact feature in that app.
- `no: <reason of 3 words or more>`: not done, on purpose or as a known gap (name the issue).
- `not checked`: nobody has observed it. Use this whenever the client fact is `not checked`.

The Server column is the server side for that language, and is always `built:` or `no:` (we can always check our own code). When it is `no:`, every client cell in that row is `no:` too.

Needs: the `clients.json` field the client must support for the feature to reach the user (`none` when every MCP client gets it: tools/list and tool results). Checked: the last date someone reviewed the row. The weekly review (#294, #295) runs `node tests/eval/client-matrix.mjs --stale` and opens one issue listing the rows with a `not checked` cell older than 30 days.

Clients are the keys of `clients.json`: Claude web (`claude_ai`), Claude Desktop, ChatGPT, Grok, Claude Code, Codex CLI and any other MCP client (`generic`). To support a new client, add it to `clients.json` first; the test then asks for its column here. Admin tools are left out: one user, English only, on purpose.

## How to change a feature

1. Change the text or code for every client path (instructions, tool text, prompts, skill, views, results, docs) and in English and Hebrew.
2. Update its row in both language tables. A new feature gets a new row in Features and in both tables.
3. Add or update an eval: the discovery corpus (`tests/eval/discovery/intents.json`, English and Hebrew phrases), the format eval (`tests/eval/discovery/format.mjs`), or a test that the `built:` cell names.
4. Task issues that touch these features carry the line `Clients and languages: <clients> / EN, HE; matrix rows: <rows>`.

## Features

| Feature | Covers | Needs | Checked |
|---|---|---|---|
| Server instructions | instructions | reads_instructions | 2026-11-21 |
| Tool descriptions | tools | none | 2026-11-21 |
| Tool choice without naming the app | tools | none | 2026-11-21 |
| Tool titles | tools | reads_tool_title | 2026-11-21 |
| Tool results | results | none | 2026-11-21 |
| Error messages | results | none | 2026-11-21 |
| Thread as text when no view shows | results | none | 2026-11-21 |
| Options and suggestions display | prompts, results | none | 2026-11-21 |
| Prompts (slash commands) | prompts | shows_prompts | 2026-11-21 |
| Skill | skill | reads_resources | 2026-11-21 |
| Thread view | view:thread | renders_ui_views | 2026-11-21 |
| Drafts view | view:drafts | renders_ui_views | 2026-11-21 |
| Share card | view:share | renders_ui_views | 2026-11-21 |
| View labels and buttons | view:thread, view:drafts, view:share | renders_ui_views | 2026-11-21 |
| Edit results | results | none | 2026-11-25 |
| Thread view after an edit | view:thread | renders_ui_views | 2026-11-25 |
| Image operations | tools | none | 2026-11-25 |
| Connect guide | docs/agents/mcp.md | none | 2026-11-21 |

## Language: en

| Feature | Server | claude_ai | claude_desktop | chatgpt | grok | claude_code | codex | generic |
|---|---|---|---|---|---|---|---|---|
| Server instructions | built: tests/api/mcp-default-use.test.js | not checked | not checked | not checked | not checked | not checked | not checked | not checked |
| Tool descriptions | built: tests/api/mcp-default-use.test.js, tests/api/client-matrix.test.js | built: tests/api/mcp-sdk-client.test.js | built: tests/api/mcp-sdk-client.test.js | built: tests/api/mcp-clients.test.js | built: tests/api/mcp-sdk-client.test.js | built: tests/api/mcp-clients.test.js | built: tests/api/mcp-clients.test.js | built: tests/api/mcp-sdk-client.test.js |
| Tool choice without naming the app | built: tests/api/mcp-discovery.test.js | not checked | not checked | not checked | no: owner saw no call unless the connector is named (#279) | not checked | not checked | not checked |
| Tool titles | built: tests/api/mcp-schema.test.js | not checked | not checked | not checked | not checked | not checked | not checked | not checked |
| Tool results | built: tests/api/mcp.test.js | built: tests/api/mcp.test.js | built: tests/api/mcp.test.js | built: tests/api/mcp.test.js | built: tests/api/mcp.test.js | built: tests/api/mcp.test.js | built: tests/api/mcp.test.js | built: tests/api/mcp.test.js |
| Error messages | built: tests/api/mcp.test.js | built: tests/api/mcp.test.js | built: tests/api/mcp.test.js | built: tests/api/mcp.test.js | built: tests/api/mcp.test.js | built: tests/api/mcp.test.js | built: tests/api/mcp.test.js | built: tests/api/mcp.test.js |
| Thread as text when no view shows | built: tests/api/mcp-ui.test.js, tests/api/mcp-discovery.test.js | built: tests/api/mcp-ui.test.js | built: tests/api/mcp-ui.test.js | built: tests/api/mcp-ui.test.js | built: tests/api/mcp-ui.test.js | built: tests/api/mcp-ui.test.js | built: tests/api/mcp-ui.test.js | built: tests/api/mcp-ui.test.js |
| Options and suggestions display | no: planned in #358 (W1) | no: planned in #358 (W1) | no: planned in #358 (W1) | no: planned in #358 (W1) | no: planned in #358 (W1) | no: planned in #358 (W1) | no: planned in #358 (W1) | no: planned in #358 (W1) |
| Prompts (slash commands) | built: tests/api/mcp-prompts.test.js | not checked | not checked | not checked | no: owner saw no slash commands (#273) | not checked | not checked | not checked |
| Skill | built: tests/api/mcp-skills.test.js | not checked | not checked | not checked | not checked | not checked | not checked | not checked |
| Thread view | built: tests/e2e/mcp-thread-view.spec.ts | built: tests/e2e/mcp-thread-view.spec.ts | not checked | built: tests/e2e/mcp-thread-view.spec.ts | not checked | not checked | not checked | not checked |
| Drafts view | built: tests/e2e/mcp-drafts-view.spec.ts | built: tests/e2e/mcp-drafts-view.spec.ts | not checked | built: tests/e2e/mcp-drafts-view.spec.ts | not checked | not checked | not checked | not checked |
| Share card | built: tests/e2e/mcp-share-view.spec.ts | built: tests/e2e/mcp-share-view.spec.ts | not checked | built: tests/e2e/mcp-share-view.spec.ts | not checked | not checked | not checked | not checked |
| View labels and buttons | built: tests/e2e/mcp-ui.spec.ts | built: tests/e2e/mcp-ui.spec.ts | not checked | built: tests/e2e/mcp-ui.spec.ts | not checked | not checked | not checked | not checked |
| Edit results | built: tests/api/mcp-edit-result.test.js | built: tests/api/mcp-edit-result.test.js | built: tests/api/mcp-edit-result.test.js | built: tests/api/mcp-edit-result.test.js | built: tests/api/mcp-edit-result.test.js | built: tests/api/mcp-edit-result.test.js | built: tests/api/mcp-edit-result.test.js | built: tests/api/mcp-edit-result.test.js |
| Thread view after an edit | built: tests/api/mcp-edit-result.test.js | built: tests/api/mcp-edit-result.test.js | not checked | built: tests/api/mcp-edit-result.test.js | not checked | not checked | not checked | not checked |
| Image operations | built: tests/api/mcp-images-parity.test.js | built: tests/api/mcp-images-parity.test.js | built: tests/api/mcp-images-parity.test.js | built: tests/api/mcp-images-parity.test.js | built: tests/api/mcp-images-parity.test.js | built: tests/api/mcp-images-parity.test.js | built: tests/api/mcp-images-parity.test.js | built: tests/api/mcp-images-parity.test.js |
| Connect guide | built: docs/agents/mcp.md | built: docs/agents/mcp.md | built: docs/agents/mcp.md | built: docs/agents/mcp.md | no: the guide has no Grok steps (#372) | built: docs/agents/mcp.md | built: docs/agents/mcp.md | built: docs/agents/mcp.md |

## Language: he

| Feature | Server | claude_ai | claude_desktop | chatgpt | grok | claude_code | codex | generic |
|---|---|---|---|---|---|---|---|---|
| Server instructions | built: tests/api/mcp-default-use.test.js, tests/api/client-matrix.test.js | not checked | not checked | not checked | not checked | not checked | not checked | not checked |
| Tool descriptions | built: tests/api/mcp-language.test.js, tests/api/client-matrix.test.js | built: tests/api/mcp-sdk-client.test.js | built: tests/api/mcp-sdk-client.test.js | built: tests/api/mcp-clients.test.js | built: tests/api/mcp-sdk-client.test.js | built: tests/api/mcp-clients.test.js | built: tests/api/mcp-clients.test.js | built: tests/api/mcp-sdk-client.test.js |
| Tool choice without naming the app | built: tests/api/mcp-discovery.test.js | not checked | not checked | not checked | no: owner saw no call unless the connector is named (#279) | not checked | not checked | not checked |
| Tool titles | no: one English title per tool | no: one English title per tool | no: one English title per tool | no: one English title per tool | no: one English title per tool | no: one English title per tool | no: one English title per tool | no: one English title per tool |
| Tool results | built: tests/api/mcp-language.test.js | built: tests/api/mcp-language.test.js | built: tests/api/mcp-language.test.js | built: tests/api/mcp-language.test.js | built: tests/api/mcp-language.test.js | built: tests/api/mcp-language.test.js | built: tests/api/mcp-language.test.js | built: tests/api/mcp-language.test.js |
| Error messages | no: English only, the assistant relays them | no: English only, the assistant relays them | no: English only, the assistant relays them | no: English only, the assistant relays them | no: English only, the assistant relays them | no: English only, the assistant relays them | no: English only, the assistant relays them | no: English only, the assistant relays them |
| Thread as text when no view shows | built: tests/e2e/mcp-grok-view.spec.ts, tests/api/mcp-discovery.test.js | built: tests/e2e/mcp-grok-view.spec.ts | built: tests/e2e/mcp-grok-view.spec.ts | built: tests/e2e/mcp-grok-view.spec.ts | built: tests/e2e/mcp-grok-view.spec.ts | built: tests/e2e/mcp-grok-view.spec.ts | built: tests/e2e/mcp-grok-view.spec.ts | built: tests/e2e/mcp-grok-view.spec.ts |
| Options and suggestions display | no: planned in #358 (W1) | no: planned in #358 (W1) | no: planned in #358 (W1) | no: planned in #358 (W1) | no: planned in #358 (W1) | no: planned in #358 (W1) | no: planned in #358 (W1) | no: planned in #358 (W1) |
| Prompts (slash commands) | built: tests/api/mcp-prompts.test.js, tests/api/client-matrix.test.js | not checked | not checked | not checked | no: owner saw no slash commands (#273) | not checked | not checked | not checked |
| Skill | built: tests/api/mcp-skills.test.js | not checked | not checked | not checked | not checked | not checked | not checked | not checked |
| Thread view | built: tests/e2e/mcp-thread-view.spec.ts | built: tests/e2e/mcp-thread-view.spec.ts | not checked | built: tests/e2e/mcp-thread-view.spec.ts | not checked | not checked | not checked | not checked |
| Drafts view | built: tests/unit/mcp-ui-drafts.test.js | built: tests/unit/mcp-ui-drafts.test.js | not checked | built: tests/unit/mcp-ui-drafts.test.js | not checked | not checked | not checked | not checked |
| Share card | built: tests/unit/mcp-ui-share.test.js | built: tests/unit/mcp-ui-share.test.js | not checked | built: tests/unit/mcp-ui-share.test.js | not checked | not checked | not checked | not checked |
| View labels and buttons | no: labels are English only (#371) | no: labels are English only (#371) | no: labels are English only (#371) | no: labels are English only (#371) | no: labels are English only (#371) | no: labels are English only (#371) | no: labels are English only (#371) | no: labels are English only (#371) |
| Edit results | no: English only, the assistant relays it | no: English only, the assistant relays it | no: English only, the assistant relays it | no: English only, the assistant relays it | no: English only, the assistant relays it | no: English only, the assistant relays it | no: English only, the assistant relays it | no: English only, the assistant relays it |
| Thread view after an edit | built: tests/api/mcp-edit-result.test.js, tests/unit/mcp-ui-thread.test.js | built: tests/unit/mcp-ui-thread.test.js | not checked | built: tests/unit/mcp-ui-thread.test.js | not checked | not checked | not checked | not checked |
| Image operations | no: no Hebrew words for these operations (#414) | no: no Hebrew words for these operations (#414) | no: no Hebrew words for these operations (#414) | no: no Hebrew words for these operations (#414) | no: no Hebrew words for these operations (#414) | no: no Hebrew words for these operations (#414) | no: no Hebrew words for these operations (#414) | no: no Hebrew words for these operations (#414) |
| Connect guide | no: the guide is English only (#372) | no: the guide is English only (#372) | no: the guide is English only (#372) | no: the guide is English only (#372) | no: the guide is English only (#372) | no: the guide is English only (#372) | no: the guide is English only (#372) | no: the guide is English only (#372) |

The thread tools add the thread as markdown after the JSON (#356): its labels are English and read by the assistant; the Hebrew post text in it stays unchanged. In Hebrew, "built" for a view means Hebrew post text shows unchanged and right to left (`dir="auto"`); the labels around it are the separate View labels row. Tool titles: MCP gives each tool one title and no language field, so Hebrew trigger words go in the description instead.

## What the cells rest on

- Claude web renders views: its help page, in `clients.json`. ChatGPT renders the thread view: Shaked's screenshot of a Hebrew draft on #357.
- Grok: tool calls only when the connector is named (#279), no slash commands seen (#273). Each was seen by Shaked; why is not checked. The thread view was an empty grey box (#352); the fix (#356, the view reads the markdown part) is not checked in Grok, so the cell is `not checked`.
- Edit results: the edit tools (#405) show the thread view from the draft as saved, and add one English line (`Saved: version N, M posts.`) with no post text.
- Every other client fact is `not checked` in `clients.json` (#278 could not load the vendors' pages). #373 checks them.
