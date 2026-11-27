# Plugin marketplace (agent-kit)

This repository is also a Claude Code plugin marketplace named `agent-kit`. It holds generic skills, commands, hooks
and scripts for agents that work on a repository. Nothing in the plugins names this app: each one reads its settings
from a small file in the project that uses it. The plan and the decisions are in
[`docs/plans/plugin-marketplace.md`](./plans/plugin-marketplace.md). The licence is MIT ([`LICENSE`](../LICENSE)).

## What is in agent-kit

| Plugin | Version | What it gives a project |
|---|---|---|
| `reply-style` | 0.3.0 | Reply templates for an agent that reports to a repository owner, a lint for them, and an opt-in Stop hook. |
| `metrics` | 0.2.0 | Two skills for a central metrics service: how to join it, and how to read its summary and act on it. |
| `task-janitor` | 0.1.0 | A read-only report of an issue tracker and the Claude Code sessions that work on it, a status board, and the `/janitor` and `/status` commands. |
| `contract-tests` | 0.1.0 | A method for end-to-end contract tests that run without a person, a client binary, a browser sign-in or a model call. |
| `pr-workflow` | 0.1.0 | The branch, commit, pull request and check-reading workflow, with one helper over the GitHub REST API. |

Each plugin has its own `README.md` (what it does and its settings) and `CHANGELOG.md` (one section per version) under
`plugins/<name>/`. The list above is the list in [`.claude-plugin/marketplace.json`](../.claude-plugin/marketplace.json).

Requirements: Claude Code, tested with 2.1.332 (the version the CI workflow pins; older versions are not checked). Node 20 for
the scripts (no npm dependencies), `git` and `gh` for `pr-workflow` and `task-janitor`.

## Install

Single user, inside Claude Code:

```
/plugin marketplace add Shaked/x-thread-draft-tool
/plugin install reply-style@agent-kit
```

Single user, in a shell (the same result, user scope):

```
claude plugin marketplace add Shaked/x-thread-draft-tool
claude plugin install reply-style@agent-kit --scope user
```

Team, for a repository that everyone works in:

```
claude plugin marketplace add Shaked/x-thread-draft-tool --scope project
claude plugin install reply-style@agent-kit --scope project
```

The project-scope commands write an `extraKnownMarketplaces` entry (a GitHub source, not a path) and an
`enabledPlugins` entry into the project's `.claude/settings.json`. Commit that file. Each collaborator still runs the
`claude plugin install ... --scope project` line once per clone, because the committed entry turns the plugin on but
does not download it (the install page of the Claude Code docs says so).

Install one plugin at a time, or all five with the same line for each name: `reply-style`, `metrics`, `task-janitor`,
`contract-tests`, `pr-workflow`, each as `<name>@agent-kit`.

Cloud sessions: the Claude Code docs say that an Anthropic-hosted cloud session does not add the marketplaces that a
repository lists under `extraKnownMarketplaces`. Not checked here; plan for a plugin to be added at claude.ai.

Check an install:

```
claude plugin list --json
claude plugin details reply-style@agent-kit
```

`details` lists the skills and the hooks the plugin brings. A restart of Claude Code (or `/reload-plugins`) applies a
change.

## Settings: `.claude/agent-kit.json`

All plugins read one file in the project: `.claude/agent-kit.json`. Where each plugin looks for it:

- `reply-style` and `metrics`: `$CLAUDE_PROJECT_DIR/.claude/agent-kit.json` when that variable is set; otherwise walk up from the working folder to the folder with `.git`.
- `task-janitor`: start at `$CLAUDE_PROJECT_DIR` (or the working folder) and walk up to the file system root.
- `pr-workflow`: `$CLAUDE_PROJECT_DIR`, else the file at the git root. It does not walk up.

A missing file or key means the default. A file that is not valid JSON stops the command with an error. A key of the wrong type stops `reply-style`, `metrics` and `pr-workflow`, including shared keys such as `repo`; `task-janitor` checks only its own section and ignores a bad shared key. Exit code 2 for `reply-style`, `task-janitor` and `metrics`; exit code 1 for `pr-workflow`. The `reply-style` Stop hook prints a warning instead and lets the turn end.

Top-level keys (shared by the plugins):

| Key | Default | Used by |
|---|---|---|
| `owner` | `the owner` | The name the reply templates use for the owner; the janitor's owner patterns |
| `ownerLogin` | empty | The owner's GitHub login (`reply-style`) |
| `repo` | empty | `owner/name`, for links and for the GitHub search (`task-janitor`); `pr-workflow` reads it too |

Per-plugin sections (the full tables are in each plugin's README):

| Section | Keys with their defaults |
|---|---|
| `reply-style` | `humans` `["the owner"]`, `allowLines` `[]`, `maxLineLength` `160`, `changelogAreas` `[]`, `extraTemplates` `{}`, `writingSkills` `[]` |
| `task-janitor` | `replyLint` not set, `manualTestsIssue` not set, `reportIssue` not set, `dispatcherIssue` not set (each a path or a whole number) |
| `metrics` | `app`, `siteUrl`, `ingestUrl` have no default; `repo` falls back to the top-level `repo`. The plugin reports a missing one |
| `pr-workflow` | `repo` (or the `AGENT_PR_REPO` variable, or the `origin` remote) |
| `contract-tests` | none |

Example for a sample project:

```json
{
  "owner": "Sam",
  "repo": "acme/sample-app",
  "reply-style": {
    "humans": ["Sam", "the owner"],
    "allowLines": ["^Implements #\\d+ Task "],
    "maxLineLength": 160
  },
  "task-janitor": {
    "reportIssue": 12
  }
}
```

The Stop hook of `reply-style` is opt-in: it runs only when `REPLY_STYLE=owner` is set in the shell that starts the agent.

## Upgrades

A plugin pins its users to its `version`. To take a newer version:

```
claude plugin marketplace update agent-kit
claude plugin update reply-style@agent-kit
```

Then restart Claude Code. The `CHANGELOG.md` of the plugin says what changed; a `Stricter:` line means a rule now fails
something that passed before.

## Contributing

- A change under `plugins/<name>/` bumps that plugin's version in two places with the same value:
  `plugins/<name>/.claude-plugin/plugin.json` and its entry in `.claude-plugin/marketplace.json`. The rule is in
  [plan section 4.5](./plans/plugin-marketplace.md). CI checks it with `node scripts/plugin-manifests.mjs --bumps`.
- Add a section to `plugins/<name>/CHANGELOG.md` for the new version. Patch for wording, minor for a new rule, template
  or config key with a default, major for a removed or renamed key, template or rule.
- Edit the plugin, not a copy. The `reply-style`, `task-janitor` and `metrics` skills under `.claude/skills/` are symlinks into `plugins/`. The `pr-workflow` and `contract-tests` plugins have separate skills in this repository.
- Tests: `npm run test:unit` (the manifest, forbidden-word, golden-fixture and config tests run there), and
  `claude plugin validate . --strict` plus `claude plugin validate plugins/<name> --strict` for the manifests. The
  `Plugin CLI` workflow installs every plugin with a pinned Claude Code CLI in an empty config folder.
- A plugin text must not contain this app's name, the owner's name, `#` with digits (except the sample numbers `#12`
  and `#34`), or a `docs/plans/` or `docs/operations/` path. The test lists them.
- The repository changelog (`docs/changelogs/`) still gets one file per change, as for any other change.

## Notes

- **Do not install these plugins in this repository.** It uses the plugin folders in place: the skills are symlinks and
  `npm run reply-lint` runs the plugin's script. An installed copy would be a second copy that lags behind `main`, and
  two Stop hooks would run here.
- **A Windows clone needs symlink support.** Without it the `.claude/skills/*` links become plain text files and the skills
  do not load. The agents for this repository run on Linux and macOS; Windows is not checked.
- A plugin never reads a path above its own folder, because a plugin is copied to a cache folder on install.

## Checks behind these commands

Run on 2026-11-27 with Claude Code `2.1.332`, with an empty `CLAUDE_CONFIG_DIR` in a temp folder and a marketplace
added from `Shaked/x-thread-draft-tool` (the GitHub source, `main` at `b667c1f`):

- `claude plugin marketplace add Shaked/x-thread-draft-tool` → `Successfully added marketplace: agent-kit`.
- `claude plugin install <name>@agent-kit --scope user` for all five plugins → each `Successfully installed`;
  `claude plugin list --json` shows `reply-style` 0.3.0, `metrics` 0.2.0, `task-janitor` 0.1.0, `contract-tests` 0.1.0,
  `pr-workflow` 0.1.0, all `enabled: true`.
- `claude plugin marketplace add Shaked/x-thread-draft-tool --scope project` in an empty git folder, then
  `claude plugin install reply-style@agent-kit --scope project` → the project `.claude/settings.json` gets
  `extraKnownMarketplaces` (github, `Shaked/x-thread-draft-tool`) and `enabledPlugins` (`reply-style@agent-kit: true`).
- `claude plugin marketplace update agent-kit` → `Successfully updated marketplace`; `claude plugin update reply-style@agent-kit`
  → `already at the latest version (0.3.0)`.
- `claude plugin details reply-style@agent-kit` → `Skills (1) reply-style`, `Hooks (1) Stop`.
- `claude plugin validate . --strict` and each `plugins/<name>` with `--strict` → `Validation passed`. The validator also
  prints "plugin directory" hints (an install line in each README, an icon, a licence line). They do not change the
  result; CI does not use the directory profile.
- `node scripts/plugin-cli-check.mjs` with an empty config folder → `plugin-cli-check: 5 plugin(s) OK`.

Not checked: the `/plugin` commands typed inside a live session (the same actions as the shell commands above, but not run
interactively); a plugin's Stop hook firing in a live session; the cloud-session install.
