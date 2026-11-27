# Client and language matrix

Every feature that an AI app or an assistant sees or uses, for every supported AI app (client) and both languages. Rule in `AGENTS.md`: a change to one of these features covers every client and both languages in the same PR, or the cell says why not.

`tests/api/client-matrix.test.js` reads the tables below. No model and no network. It fails when:
- a client in `tests/eval/discovery/clients.json` has no column, or a language in its `languages` list has no table;
- a feature row or a cell is missing, or a cell is not one of the three forms below;
- a `built:` cell names a file that does not exist, or a `no:` reason has fewer than 3 words;
- a cell says `built` while `clients.json` says `not checked` (or `false`) for what the feature needs;
- a served view (`view:<name>`) or a surface (instructions, tools, results, prompts, skill) has no row;
- a tool or prompt description has an English trigger part without a Hebrew one, or the reverse, or Latin words left in the Hebrew part (product names such as X and Twitter are allowed).

What the test cannot see, so the reviewer checks it in the PR diff:
- For the server instructions and the skill description it only asks for some Hebrew words, not a Hebrew part for each new English sentence.
- A whole feature row deleted from all three tables passes when another row still covers the same surface.
- A `true` value in `clients.json` is checked for a source URL, not for what that page says. Read the source of every new `true`.

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
| Server instructions | instructions | reads_instructions | 2026-11-26 |
| Tool descriptions | tools | none | 2026-11-21 |
| Tool choice without naming the app | tools | none | 2026-11-21 |
| Tool titles | tools | reads_tool_title | 2026-11-21 |
| Tool results | results | none | 2026-11-21 |
| Error messages | results | none | 2026-11-21 |
| Thread as text when no view shows | results | none | 2026-11-21 |
| Edit at once and short answer (R1 to R3) | instructions, skill, results | reads_instructions | 2026-11-27 |
| Options and post text as quotes (R4 to R6) | instructions, prompts, skill | reads_instructions | 2026-11-27 |
| Image counts (R9, plan 3.1) | skill, results | reads_resources | 2026-11-27 |
| Prompts (slash commands) | prompts | shows_prompts | 2026-11-26 |
| Skill | skill | reads_resources | 2026-11-26 |
| Thread view | view:thread | renders_ui_views | 2026-11-21 |
| Drafts view | view:drafts | renders_ui_views | 2026-11-21 |
| Share card | view:share | renders_ui_views | 2026-11-21 |
| View labels and buttons | view:thread, view:drafts, view:share | renders_ui_views | 2026-11-26 |
| Edit results | results | none | 2026-11-25 |
| State line in draft results | results | none | 2026-11-26 |
| Thread view after an edit | view:thread | renders_ui_views | 2026-11-25 |
| Image operations | tools | none | 2026-11-27 |
| Draft history over REST (#378) | results | none | 2026-11-27 |
| Agent plugin: reply-style | docs/plans/plugin-marketplace.md | none | 2026-11-26 |
| Agent skill: ui-debug | tests/unit/ui-debug-skill.test.js | none | 2026-11-26 |
| Agent plugin: metrics | docs/plans/central-metrics.md | none | 2026-11-26 |
| Agent plugin: task-janitor | docs/plans/plugin-marketplace.md | none | 2026-11-27 |
| Agent plugin: pr-workflow | docs/plans/plugin-marketplace.md | none | 2026-11-27 |
| Agent plugin: contract-tests | docs/plans/plugin-marketplace.md | none | 2026-11-27 |
| Connect guide | docs/agents/mcp.md | none | 2026-11-26 |

## Language: en

| Feature | Server | claude_ai | claude_desktop | chatgpt | grok | claude_code | codex | generic |
|---|---|---|---|---|---|---|---|---|
| Server instructions | built: tests/api/mcp-default-use.test.js | not checked | not checked | not checked | not checked | built: tests/api/mcp-default-use.test.js | not checked | not checked |
| Tool descriptions | built: tests/api/mcp-default-use.test.js, tests/api/client-matrix.test.js | built: tests/api/mcp-sdk-client.test.js | built: tests/api/mcp-sdk-client.test.js | built: tests/api/mcp-clients.test.js | built: tests/api/mcp-sdk-client.test.js | built: tests/api/mcp-clients.test.js | built: tests/api/mcp-clients.test.js | built: tests/api/mcp-sdk-client.test.js |
| Tool choice without naming the app | built: tests/api/mcp-discovery.test.js | not checked | not checked | not checked | no: owner saw no call unless the connector is named (#279) | not checked | not checked | not checked |
| Tool titles | built: tests/api/mcp-schema.test.js | not checked | not checked | not checked | not checked | not checked | not checked | not checked |
| Tool results | built: tests/api/mcp.test.js | built: tests/api/mcp.test.js | built: tests/api/mcp.test.js | built: tests/api/mcp.test.js | built: tests/api/mcp.test.js | built: tests/api/mcp.test.js | built: tests/api/mcp.test.js | built: tests/api/mcp.test.js |
| Error messages | built: tests/api/mcp.test.js, tests/api/mcp-chat-image-error.test.js | built: tests/api/mcp.test.js, tests/api/mcp-chat-image-error.test.js | built: tests/api/mcp.test.js, tests/api/mcp-chat-image-error.test.js | built: tests/api/mcp.test.js, tests/api/mcp-chat-image-error.test.js | built: tests/api/mcp.test.js, tests/api/mcp-chat-image-error.test.js | built: tests/api/mcp.test.js, tests/api/mcp-chat-image-error.test.js | built: tests/api/mcp.test.js, tests/api/mcp-chat-image-error.test.js | built: tests/api/mcp.test.js, tests/api/mcp-chat-image-error.test.js |
| Thread as text when no view shows | built: tests/api/mcp-ui.test.js, tests/api/mcp-discovery.test.js | built: tests/api/mcp-ui.test.js | built: tests/api/mcp-ui.test.js | built: tests/api/mcp-ui.test.js | not checked | built: tests/api/mcp-ui.test.js | built: tests/api/mcp-ui.test.js | built: tests/api/mcp-ui.test.js |
| Options and post text as quotes (R4 to R6) | built: tests/api/draft-contract.test.js | not checked | not checked | not checked | not checked | not checked | not checked | not checked |
| Edit at once and short answer (R1 to R3) | built: tests/api/draft-contract.test.js | not checked | not checked | not checked | not checked | not checked | not checked | not checked |
| Image counts (R9, plan 3.1) | built: tests/api/draft-contract.test.js | not checked | not checked | not checked | not checked | not checked | not checked | not checked |
| Prompts (slash commands) | built: tests/api/mcp-prompts.test.js | not checked | not checked | not checked | no: owner saw no slash commands (#273) | built: tests/api/mcp-prompts.test.js | not checked | not checked |
| Skill | built: tests/api/mcp-skills.test.js | not checked | not checked | not checked | not checked | built: tests/api/mcp-skills.test.js | not checked | not checked |
| Thread view | built: tests/e2e/mcp-thread-view.spec.ts | built: tests/e2e/mcp-thread-view.spec.ts | not checked | built: tests/e2e/mcp-thread-view.spec.ts | not checked | not checked | not checked | not checked |
| Drafts view | built: tests/e2e/mcp-drafts-view.spec.ts | built: tests/e2e/mcp-drafts-view.spec.ts | not checked | built: tests/e2e/mcp-drafts-view.spec.ts | not checked | not checked | not checked | not checked |
| Share card | built: tests/e2e/mcp-share-view.spec.ts | built: tests/e2e/mcp-share-view.spec.ts | not checked | built: tests/e2e/mcp-share-view.spec.ts | not checked | not checked | not checked | not checked |
| View labels and buttons | built: tests/e2e/mcp-ui.spec.ts | built: tests/e2e/mcp-ui.spec.ts | not checked | built: tests/e2e/mcp-ui.spec.ts | not checked | not checked | not checked | not checked |
| Edit results | built: tests/api/mcp-edit-result.test.js, tests/api/mcp-discovery.test.js | built: tests/api/mcp-edit-result.test.js | built: tests/api/mcp-edit-result.test.js | built: tests/api/mcp-edit-result.test.js | built: tests/api/mcp-edit-result.test.js | built: tests/api/mcp-edit-result.test.js | built: tests/api/mcp-edit-result.test.js | built: tests/api/mcp-edit-result.test.js |
| State line in draft results | built: tests/unit/mcp-state-line.test.js, tests/api/mcp-state-line.test.js | built: tests/api/mcp-state-line.test.js | built: tests/api/mcp-state-line.test.js | built: tests/api/mcp-state-line.test.js | built: tests/api/mcp-state-line.test.js | built: tests/api/mcp-state-line.test.js | built: tests/api/mcp-state-line.test.js | built: tests/api/mcp-state-line.test.js |
| Thread view after an edit | built: tests/api/mcp-edit-result.test.js | built: tests/api/mcp-edit-result.test.js | not checked | built: tests/api/mcp-edit-result.test.js | not checked | not checked | not checked | not checked |
| Image operations | built: tests/api/mcp-images-parity.test.js | built: tests/api/mcp-images-parity.test.js | built: tests/api/mcp-images-parity.test.js | built: tests/api/mcp-images-parity.test.js | built: tests/api/mcp-images-parity.test.js | built: tests/api/mcp-images-parity.test.js | built: tests/api/mcp-images-parity.test.js | built: tests/api/mcp-images-parity.test.js |
| Draft history over REST (#378) | no: MCP tools come in H7 (#380) | no: MCP tools come in H7 (#380) | no: MCP tools come in H7 (#380) | no: MCP tools come in H7 (#380) | no: MCP tools come in H7 (#380) | no: MCP tools come in H7 (#380) | no: MCP tools come in H7 (#380) | no: MCP tools come in H7 (#380) |
| Agent plugin: reply-style | built: tests/unit/plugin-reply-style.test.js | no: a Claude Code plugin only | no: a Claude Code plugin only | no: a Claude Code plugin only | no: a Claude Code plugin only | not checked | no: a Claude Code plugin only | no: a Claude Code plugin only |
| Agent skill: ui-debug | built: tests/unit/ui-debug-skill.test.js | no: a repo developer skill only | no: a repo developer skill only | no: a repo developer skill only | no: a repo developer skill only | not checked | no: a repo developer skill only | no: a repo developer skill only |
| Agent plugin: metrics | built: tests/unit/plugin-metrics.test.js | no: a Claude Code plugin only | no: a Claude Code plugin only | no: a Claude Code plugin only | no: a Claude Code plugin only | not checked | no: a Claude Code plugin only | no: a Claude Code plugin only |
| Agent plugin: task-janitor | built: tests/unit/task-janitor-plugin.test.js | no: a Claude Code plugin only | no: a Claude Code plugin only | no: a Claude Code plugin only | no: a Claude Code plugin only | not checked | no: a Claude Code plugin only | no: a Claude Code plugin only |
| Agent plugin: pr-workflow | built: tests/unit/plugin-pr-workflow.test.js | no: developer tooling for repo agents, not an app client | no: developer tooling for repo agents, not an app client | no: developer tooling for repo agents, not an app client | no: developer tooling for repo agents, not an app client | not checked | no: developer tooling for repo agents, not an app client | no: developer tooling for repo agents, not an app client |
| Agent plugin: contract-tests | built: tests/unit/plugin-contract-tests.test.js | no: a Claude Code plugin only | no: a Claude Code plugin only | no: a Claude Code plugin only | no: a Claude Code plugin only | not checked | no: a Claude Code plugin only | no: a Claude Code plugin only |
| Connect guide | built: docs/agents/mcp.md | built: docs/agents/mcp.md | built: docs/agents/mcp.md | built: docs/agents/mcp.md | not checked | built: docs/agents/mcp.md | built: docs/agents/mcp.md | no: no steps for other MCP clients (#372) |

## Language: he

| Feature | Server | claude_ai | claude_desktop | chatgpt | grok | claude_code | codex | generic |
|---|---|---|---|---|---|---|---|---|
| Server instructions | built: tests/api/mcp-default-use.test.js, tests/api/client-matrix.test.js | not checked | not checked | not checked | not checked | built: tests/api/mcp-default-use.test.js, tests/api/client-matrix.test.js | not checked | not checked |
| Tool descriptions | built: tests/api/mcp-language.test.js, tests/api/client-matrix.test.js | built: tests/api/mcp-sdk-client.test.js | built: tests/api/mcp-sdk-client.test.js | built: tests/api/mcp-clients.test.js | built: tests/api/mcp-sdk-client.test.js | built: tests/api/mcp-clients.test.js | built: tests/api/mcp-clients.test.js | built: tests/api/mcp-sdk-client.test.js |
| Tool choice without naming the app | built: tests/api/mcp-discovery.test.js | not checked | not checked | not checked | no: owner saw no call unless the connector is named (#279) | not checked | not checked | not checked |
| Tool titles | no: one English title per tool | no: one English title per tool | no: one English title per tool | no: one English title per tool | no: one English title per tool | no: one English title per tool | no: one English title per tool | no: one English title per tool |
| Tool results | built: tests/api/mcp-language.test.js | built: tests/api/mcp-language.test.js | built: tests/api/mcp-language.test.js | built: tests/api/mcp-language.test.js | built: tests/api/mcp-language.test.js | built: tests/api/mcp-language.test.js | built: tests/api/mcp-language.test.js | built: tests/api/mcp-language.test.js |
| Error messages | no: English only, the assistant relays them | no: English only, the assistant relays them | no: English only, the assistant relays them | no: English only, the assistant relays them | no: English only, the assistant relays them | no: English only, the assistant relays them | no: English only, the assistant relays them | no: English only, the assistant relays them |
| Thread as text when no view shows | built: tests/e2e/mcp-grok-view.spec.ts, tests/api/mcp-discovery.test.js | built: tests/e2e/mcp-grok-view.spec.ts | built: tests/e2e/mcp-grok-view.spec.ts | built: tests/e2e/mcp-grok-view.spec.ts | not checked | built: tests/e2e/mcp-grok-view.spec.ts | built: tests/e2e/mcp-grok-view.spec.ts | built: tests/e2e/mcp-grok-view.spec.ts |
| Edit at once and short answer (R1 to R3) | built: tests/api/draft-contract.test.js | not checked | not checked | not checked | not checked | not checked | not checked | not checked |
| Options and post text as quotes (R4 to R6) | built: tests/api/draft-contract.test.js | not checked | not checked | not checked | not checked | not checked | not checked | not checked |
| Image counts (R9, plan 3.1) | built: tests/api/draft-contract.test.js | not checked | not checked | not checked | not checked | not checked | not checked | not checked |
| Prompts (slash commands) | built: tests/api/mcp-prompts.test.js, tests/api/client-matrix.test.js | not checked | not checked | not checked | no: owner saw no slash commands (#273) | built: tests/api/mcp-prompts.test.js, tests/api/client-matrix.test.js | not checked | not checked |
| Skill | built: tests/api/mcp-skills.test.js | not checked | not checked | not checked | not checked | built: tests/api/mcp-skills.test.js | not checked | not checked |
| Thread view | built: tests/e2e/mcp-thread-view.spec.ts | built: tests/e2e/mcp-thread-view.spec.ts | not checked | built: tests/e2e/mcp-thread-view.spec.ts | not checked | not checked | not checked | not checked |
| Drafts view | built: tests/unit/mcp-ui-drafts.test.js | built: tests/unit/mcp-ui-drafts.test.js | not checked | built: tests/unit/mcp-ui-drafts.test.js | not checked | not checked | not checked | not checked |
| Share card | built: tests/unit/mcp-ui-share.test.js | built: tests/unit/mcp-ui-share.test.js | not checked | built: tests/unit/mcp-ui-share.test.js | not checked | not checked | not checked | not checked |
| View labels and buttons | built: tests/unit/mcp-ui-language.test.js, tests/api/client-matrix.test.js | built: tests/e2e/mcp-ui-hebrew.spec.ts | not checked | built: tests/e2e/mcp-ui-hebrew.spec.ts | not checked | not checked | not checked | not checked |
| Edit results | built: tests/api/mcp-discovery.test.js | built: tests/api/mcp-discovery.test.js | built: tests/api/mcp-discovery.test.js | built: tests/api/mcp-discovery.test.js | built: tests/api/mcp-discovery.test.js | built: tests/api/mcp-discovery.test.js | built: tests/api/mcp-discovery.test.js | built: tests/api/mcp-discovery.test.js |
| State line in draft results | built: tests/api/mcp-discovery.test.js, tests/api/mcp-state-line.test.js | built: tests/api/mcp-discovery.test.js | built: tests/api/mcp-discovery.test.js | built: tests/api/mcp-discovery.test.js | built: tests/api/mcp-discovery.test.js | built: tests/api/mcp-discovery.test.js | built: tests/api/mcp-discovery.test.js | built: tests/api/mcp-discovery.test.js |
| Thread view after an edit | built: tests/api/mcp-edit-result.test.js, tests/unit/mcp-ui-thread.test.js | built: tests/unit/mcp-ui-thread.test.js | not checked | built: tests/unit/mcp-ui-thread.test.js | not checked | not checked | not checked | not checked |
| Image operations | no: Hebrew trigger words lower other tools' ranks in the discovery score (measured 2026-11-27, #414); the English text and parameter descriptions name the operations | no: Hebrew trigger words lower other tools' ranks in the discovery score (measured 2026-11-27, #414); the English text and parameter descriptions name the operations | no: Hebrew trigger words lower other tools' ranks in the discovery score (measured 2026-11-27, #414); the English text and parameter descriptions name the operations | no: Hebrew trigger words lower other tools' ranks in the discovery score (measured 2026-11-27, #414); the English text and parameter descriptions name the operations | no: Hebrew trigger words lower other tools' ranks in the discovery score (measured 2026-11-27, #414); the English text and parameter descriptions name the operations | no: Hebrew trigger words lower other tools' ranks in the discovery score (measured 2026-11-27, #414); the English text and parameter descriptions name the operations | no: Hebrew trigger words lower other tools' ranks in the discovery score (measured 2026-11-27, #414); the English text and parameter descriptions name the operations | no: Hebrew trigger words lower other tools' ranks in the discovery score (measured 2026-11-27, #414); the English text and parameter descriptions name the operations |
| Draft history over REST (#378) | no: MCP tools come in H7 (#380) | no: MCP tools come in H7 (#380) | no: MCP tools come in H7 (#380) | no: MCP tools come in H7 (#380) | no: MCP tools come in H7 (#380) | no: MCP tools come in H7 (#380) | no: MCP tools come in H7 (#380) | no: MCP tools come in H7 (#380) |
| Agent plugin: reply-style | no: the lint rules are English only | no: the lint rules are English only | no: the lint rules are English only | no: the lint rules are English only | no: the lint rules are English only | no: the lint rules are English only | no: the lint rules are English only | no: the lint rules are English only |
| Agent plugin: pr-workflow | no: developer tooling, English only | no: developer tooling, English only | no: developer tooling, English only | no: developer tooling, English only | no: developer tooling, English only | no: developer tooling, English only | no: developer tooling, English only | no: developer tooling, English only |
| Agent skill: ui-debug | no: the skill is English only | no: the skill is English only | no: the skill is English only | no: the skill is English only | no: the skill is English only | no: the skill is English only | no: the skill is English only | no: the skill is English only |
| Agent plugin: metrics | no: the skills are English only | no: the skills are English only | no: the skills are English only | no: the skills are English only | no: the skills are English only | no: the skills are English only | no: the skills are English only | no: the skills are English only |
| Agent plugin: task-janitor | no: the skills are English only | no: the skills are English only | no: the skills are English only | no: the skills are English only | no: the skills are English only | no: the skills are English only | no: the skills are English only | no: the skills are English only |
| Agent plugin: contract-tests | no: the skill is English only | no: the skill is English only | no: the skill is English only | no: the skill is English only | no: the skill is English only | no: the skill is English only | no: the skill is English only | no: the skill is English only |
| Connect guide | built: docs/agents/mcp.he.md | built: docs/agents/mcp.he.md | built: docs/agents/mcp.he.md | built: docs/agents/mcp.he.md | not checked | built: docs/agents/mcp.he.md | built: docs/agents/mcp.he.md | no: no steps for other MCP clients (#372) |

The thread tools add the thread as markdown after the JSON (#356): its labels are English and read by the assistant; the Hebrew post text in it stays unchanged. In Hebrew, "built" for a view means Hebrew post text shows unchanged and right to left (`dir="auto"`); the labels around it are the separate View labels row (#371): every label and button of the three views has an English and a Hebrew text, and in Hebrew the page gets `lang="he"` and `dir="rtl"`. Tool titles: MCP gives each tool one title and no language field, so Hebrew trigger words go in the description instead.

## What the cells rest on

- Claude web renders views: its help page, in `clients.json`. ChatGPT renders the thread view: Shaked's screenshot of a Hebrew draft on #357. The ChatGPT drafts view and share card cells rest on the same fact (the same view mechanism); nobody has seen those two views in ChatGPT.
- Grok: tool calls only when the connector is named (#279), no slash commands seen (#273). Each was seen by Shaked; why is not checked. The Grok connect steps in the guide come from search results, because docs.x.ai could not be read on 2026-11-26, so the Grok connect cells are `not checked` (manual test: #430 item 5). The thread view was an empty grey box (#352); the fix (#356, the view reads the markdown part) is not checked in Grok, so the cell is `not checked`.
- Edit results: the edit tools (#405) show the thread view from the draft as saved, with only the changed posts. The text quotes the changed posts as they are now; the "after the edit" sentence, the version and the count are in the state line that ends the result. In Hebrew, the format eval checks that the changed post comes back exactly as written and that no unchanged post is quoted.
- State line (#390): every successful draft result ends with one English line: draft id, version, post count, posts over 280, image count, the editor link and one fixed next-step sentence. It holds no title, post text or image url. In Hebrew the line is the same ASCII text (ids and numbers); the format eval checks that no Hebrew user text leaks into it. What each client does with the line is not checked.
- Claude Code reads server instructions, shows prompts and reads resources: https://code.claude.com/docs/en/mcp, read 2026-11-26 (#373). Its views and tool titles are `not checked` (the page does not say).
- Every other client fact is `not checked` in `clients.json`: the vendor pages for ChatGPT, Grok, Codex and the MCP spec did not load on 2026-11-26 (DNS failure from the build container), and the Claude support pages are silent. Hand tests: #430 item 7.
- View language (#371). A view picks its language from one signal, in this order: the host's `locale` in `hostContext` (`he` or `iw` gives Hebrew, any other locale gives English), else the main script of the draft text (more Hebrew than Latin letters gives Hebrew), else English. The share card has no draft text, so with no locale it is English. Per client, whether the host sends `locale`:
  - Claude web: not checked. The fallback to the draft text works with no locale (fixture host, `tests/e2e/mcp-ui-hebrew.spec.ts`).
  - Claude Desktop, ChatGPT, Grok, Claude Code, Codex CLI, other MCP clients: not checked. ChatGPT's own `window.openai.locale` is not read (not checked whether it exists).
  - The e2e scenes use the hand-written fixture host, not a real client. They show the labels, the direction and the fallback; they say nothing about how a real client draws the view.
- What each host can do (theme source, link method, full screen, CSP key, safe-area insets) is the table `hostTable()` in `server/mcp/ui/hosts.js`; the parts of a post (images, tweet card, numbered divider, start and end lines) are one renderer each in `server/mcp/ui/render/`. A client improvement is one row or one renderer (#292). `tests/unit/mcp-ui-hosts.test.js` runs the thread view on three fixture hosts; `tests/unit/mcp-ui-golden.test.js` pins the HTML of each view.
- The view labels are the table `labels()` in `server/mcp/ui/client.js`, one section per view plus `common`. `tests/unit/mcp-ui-language.test.js` fails for a label the code uses and the table lacks, and for a label nothing uses. `viewLabelProblems` in `tests/eval/client-matrix.mjs` fails for a key without Hebrew or without English, an untranslated Latin word, or different `{marks}`. The format eval (`tests/eval/discovery/format.mjs`) checks every label for direction marks and invisible characters.
