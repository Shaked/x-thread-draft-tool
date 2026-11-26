# Plan: a plugin marketplace of generic agent skills, commands and hooks

Issue: [#502 plugin marketplace](https://github.com/Shaked/x-thread-draft-tool/issues/502), epic
[#407 Epic 2](https://github.com/Shaked/x-thread-draft-tool/issues/407). Written 2026-11-26 by an Opus session (step 1 of the issue).
This file is the plan; each build step below is its own task issue under #407.

## 1. Goal and limits

The owner asked (2026-11-26, #502): the skills, commands and hooks of this repo become a marketplace that other
projects can install; they become generic (nothing about this app); the reply templates come first.

Out of scope: the product (the app, its API and MCP server). The marketplace is developer tooling for agents that
work on a repository. It is not a product surface, so it gets no row in `docs/architecture/client-matrix.md`: no AI
app connected to the product sees it. Claude Code is the only client that installs these plugins; Codex and other
agents read the same files by path through `AGENTS.md` (section 4).

## 2. Licence: what stays private until the owner decides

The repository has no `LICENSE` file (checked 2026-11-26 on `main`). The owner question is on #502 (recommendation:
MIT). The repository is public, so anyone can read the files today, but nobody else has the right to reuse them.
Until a `LICENSE` file is merged:

- The build tasks go ahead: the plugins are built, tested and used by this repo.
- No install instructions in `README.md`, and `docs/marketplace.md` says "not published: licence not decided".
- No plugin manifest has a `license` field, and no plugin has its own `LICENSE` file.
- Nothing is announced or submitted anywhere (no plugin directory submission).
- Third-party content (pstack) is never republished in a plugin (section 6, row pstack).

Agents do not add a licence. When the owner answers, one small PR adds `LICENSE` at the root, the `license` field
(SPDX id) in every `plugin.json`, and the install section in `README.md`.

## 3. What the documentation says (read 2026-11-26)

Pages read on 2026-11-26 (no per-page date shown; the docs map said "Last updated: 2026-11-25 06:20:24 UTC").
Quotes are verbatim. Facts marked "checked here" were run with Claude Code `2.1.332` in this container.

| Fact | Source |
|---|---|
| "Save the marketplace file at `.claude-plugin/marketplace.json` in your marketplace's directory." | [create-marketplace](https://code.claude.com/docs/en/plugins/create-marketplace.md) |
| Marketplace: "`name`, `owner`, and `plugins` are required." A plugin entry: "`name` and `source` are required." | [marketplace-reference](https://code.claude.com/docs/en/plugins/marketplace-reference.md) |
| A relative source is "A directory inside the marketplace, resolved from the marketplace root. Must start with `./`" | marketplace-reference |
| "Save the manifest at `.claude-plugin/plugin.json` under the plugin root. Put every other plugin file at the plugin root" | [manifest-reference](https://code.claude.com/docs/en/plugins/manifest-reference.md) |
| "`name` is the only required key." Plugin names: "use kebab-case"; names that start with `claude-`, `anthropic-`, `anthropics-` or `cc-plugin-` are refused | manifest-reference |
| Skills: "One `<name>/SKILL.md` per skill." Hooks: "`hooks/hooks.json`" | manifest-reference, standard layout |
| "The name `scripts/` is a convention, not something Claude Code looks for" | [components](https://code.claude.com/docs/en/plugins/components.md) |
| `${CLAUDE_PLUGIN_ROOT}`: "Absolute path of the plugin's installed version"; it resolves in hook commands and "Anywhere in the Markdown body" of a skill | manifest-reference, environment variables |
| `${CLAUDE_PLUGIN_ROOT}` "changes when the plugin updates, so don't write state there." | manifest-reference |
| Hooks file: "under a top-level `"hooks"` key, in the same shape as the `hooks` object in `settings.json`." | components |
| "A plugin's hooks don't wait for one of the plugin's skills or commands to be used." | components |
| A plugin skill is invoked "as `/plugin-name:skill-name`"; a plugin skill and a project skill of the same name "Both load" | [skills](https://code.claude.com/docs/en/skills.md) |
| Install: `/plugin marketplace add owner/repo`, then `/plugin install <name>@<marketplace>`; shell: `claude plugin install <name>@<marketplace> --scope project` | [install](https://code.claude.com/docs/en/plugins/install.md), [cli-reference](https://code.claude.com/docs/en/plugins/cli-reference.md) |
| A committed `enabledPlugins` entry "turns the plugin on for your collaborators but doesn't download it to their machines. Each collaborator also runs `claude plugin install <name>@<marketplace> --scope project` once per clone." | install |
| "An Anthropic-hosted cloud session doesn't add the marketplaces a repository lists under `extraKnownMarketplaces`" | [loading](https://code.claude.com/docs/en/plugins/loading.md) |
| A plugin from a git marketplace is copied to `cache/<marketplace>/<plugin>/<version>/`; "Files outside the plugin directory aren't copied" | loading |
| A plugin from a marketplace added by local path "loads in place"; edits apply at the next session start or `/reload-plugins` | loading |
| Version: "Setting it keeps users on that version until you change it." Without one, a git source uses the commit sha | manifest-reference, loading |
| `claude plugin validate <path>` "is the authoritative check for a manifest"; `--strict` "Treat warnings as errors" | manifest-reference; `claude plugin validate --help`, checked here |
| `claude plugin tag` "Create a {name}--v{version} git tag for a plugin release, validating that plugin.json and any enclosing marketplace entry agree" | `claude plugin --help`, checked here |
| `--plugin-dir <path>`: load a plugin from a folder for one session only | cli-reference; `claude --help`, checked here |

Checked here with a throwaway marketplace in a temp folder (`CLAUDE_CONFIG_DIR` set to a temp folder):

- `claude plugin validate .` passed a marketplace with one relative-path plugin, and listed its `Stop` hook and skill
  (`skills: reply-style:reply-style`). With `--strict` it failed on warnings: no `author`, no `README.md`, no icon,
  no `network.hosts`. So every plugin gets `author`, a `README.md` and an empty `network.hosts` list; the icon is a
  plugin directory listing check and is skipped while nothing is published.
- `claude plugin marketplace add ./ --scope project` writes the absolute path of the folder into
  `.claude/settings.json`. That path is wrong in every other clone, so this repo never commits that entry.
- A marketplace written into `.claude/settings.json` by hand (not added with the command) did not show in
  `claude plugin marketplace list` in a non-interactive shell. The docs say project marketplaces need the
  workspace trust dialog.
- A project skill folder that is a symlink (`.claude/skills/x -> ../../plugins/demo/skills/x`) loaded: a headless
  `claude -p` run listed the skill by name.

Not checked: that a `Stop` hook in a plugin's `hooks.json` fires (the validator accepts it; the hooks page was not
read in this run); which of the two loads when a bare `/name` matches a plugin skill and a project skill.

## 4. Decisions

### 4.1 Layout and names
```
.claude-plugin/marketplace.json        marketplace "agent-kit", owner, one entry per plugin
plugins/<name>/.claude-plugin/plugin.json
plugins/<name>/README.md               what it does, config keys, install lines (install lines only after the licence)
plugins/<name>/CHANGELOG.md            one section per version
plugins/<name>/skills/<skill>/SKILL.md and templates/
plugins/<name>/commands/<command>.md   only where a skill does not fit
plugins/<name>/hooks/hooks.json        commands use "${CLAUDE_PLUGIN_ROOT}/scripts/..."
plugins/<name>/scripts/*.mjs           Node 20, no dependencies
plugins/<name>/fixtures/               golden fixtures, shipped as examples
```
- Marketplace name `agent-kit`: short, not reserved, no app or owner name. The `owner` field of `marketplace.json`
  is the publisher and needs a name: the owner's GitHub login, the one place it appears.
- Plugin names: `reply-style`, `task-janitor`, `pr-workflow`, `contract-tests`. Installed names:
  `reply-style@agent-kit`.
- Every relative source starts with `./`. A plugin never reads a path above its own root: the cache copy would not
  have it (docs, section 3).
- How another project installs, once the licence is merged:
  `/plugin marketplace add Shaked/x-thread-draft-tool`, then `/plugin install reply-style@agent-kit`.
  For a team: `claude plugin install reply-style@agent-kit --scope project` and commit `.claude/settings.json`.
  For cloud sessions: the docs point to adding the plugin at claude.ai (install page, "Cloud session"); not checked.

### 4.2 One source of truth: this repo uses the plugin folders in place
The only copy of each plugin's files is under `plugins/<name>/`. This repo reads them by path:

- Skills: `.claude/skills/<skill>` is a symlink to `../../plugins/<name>/skills/<skill>`. Checked here: Claude Code
  loads a symlinked project skill. Codex and other agents follow the same path from `AGENTS.md`.
- Hooks: `.claude/settings.json` runs `node "$CLAUDE_PROJECT_DIR/plugins/reply-style/scripts/reply-style-stop.mjs"`.
- Scripts: `npm run reply-lint` runs the plugin script. `scripts/reply-lint.mjs` becomes a one-line re-export,
  because `janitor.mjs`, `reply-lint-comment.mjs`, `changelog-check.mjs` and `notify-telegram.mjs` import it.
- Settings: this repo's values live in `.claude/agent-kit.json` (4.3).

Why not install the plugin in this repo: most sessions here are cloud sessions, and the docs say they do not add a
repository's `extraKnownMarketplaces`; a local-path marketplace entry holds an absolute path; and an installed copy
would be a second copy that lags behind `main`. Why not a copied folder with a "same content" test: two copies in
every diff. A symlink is one copy. Risk: a Windows clone without symlink support sees a text file; this repo's
agents run on Linux and macOS, so that is accepted and written in `docs/marketplace.md`.

Install from the marketplace is still tested (section 5, install test), so what other projects get is what runs here.

### 4.3 How generic is made: one config file per project
- No app name, owner name, issue number or repo path in any plugin text. The test in section 5 enforces it.
- Project settings are in one file, `.claude/agent-kit.json`. Each plugin reads the common keys and its own section,
  and uses the defaults below when the file or a key is missing. Scripts find it at `$CLAUDE_PROJECT_DIR`, else by
  walking up from the working folder to the git root, or take `--config <file>`. A file that is not valid JSON,
  or a key of the wrong type, stops the script with exit 2 and names the key.
- Not used: `userConfig` in `plugin.json`. It is set per person at install time; these settings belong to the
  project and are committed.

```json
{
  "owner": "Sam",
  "repo": "acme/sample-app",
  "reply-style": {
    "humans": ["Sam", "the owner"],
    "allowLines": ["^Implements #\\d+ Task "],
    "maxLineLength": 160,
    "languages": ["en"],
    "changelogAreas": ["Editor", "Docs"],
    "extraTemplates": { "changelog-entry": "docs/templates/changelog-entry.md" },
    "writingSkills": ["unslop"],
    "optIn": { "env": "REPLY_STYLE", "value": "owner" }
  },
  "task-janitor": {
    "labels": { "epic": "epic", "task": "task", "held": "held", "owner": "owner", "queue": "dispatch" },
    "markers": { "claim": "CLAIM", "handoff": "HANDOFF", "release": "RELEASE" },
    "staleDays": 14,
    "claimStaleHours": 3,
    "subIssueLimit": 100
  }
}
```

| Key | Default | Used for |
|---|---|---|
| `owner` | `the owner` | The name in skill text and in the Stop hook message |
| `repo` | from `git remote get-url origin` | Links in examples and in janitor output |
| `reply-style.humans` | `[owner, "you", "the owner"]` | Words after "blocked on" and "waiting for" that mean a person |
| `reply-style.allowLines` | `[]` | Regular expressions for lines the lint skips (this repo: the net-lines line) |
| `reply-style.maxLineLength` | `160` | The `long-line` rule |
| `reply-style.languages` | `["en"]` | Rule sets. Only `en` exists in version 1; another value stops with exit 2 |
| `reply-style.changelogAreas` | `[]` (any one word) | The `Area:` line of `--kind=changelog` |
| `reply-style.extraTemplates` | `{}` | Project templates the skill lists next to its own (this repo: changelog entry, Telegram) |
| `reply-style.writingSkills` | `[]` | Writing skills the skill tells the agent to apply, by name (this repo: the pstack copies) |
| `reply-style.optIn` | `REPLY_STYLE=owner` | The environment variable that turns the Stop hook on |
| `task-janitor.*` | the values in the example | Label names, comment markers and limits |

The templates and fixtures take their examples from a neutral sample project: `acme/sample-app`, owner "Sam",
issues `#12` and `#34`. This repo's own example texts (Telegram, changelog) move to `extraTemplates` files.

### 4.4 Versions, changelog and upgrades
- `version` in `plugin.json` and in the marketplace entry, the same value (a test checks it; `claude plugin tag`
  also checks it). Semver: patch for wording, minor for a new rule, template or config key with a default, major for
  a removed or renamed key, template or rule. A stricter rule is minor, and its changelog line starts with "Stricter:".
- Because a set version pins users (docs, section 3), every PR that changes files under `plugins/<name>/` bumps that
  plugin's version and adds a `CHANGELOG.md` section. A unit test compares with `origin/main` and fails otherwise.
- Release tags: `claude plugin tag plugins/<name>` creates `<name>--v<version>`. Tags are pushed only after the
  licence is merged.
- Upgrade for another project: `claude plugin marketplace update agent-kit`, then
  `claude plugin update reply-style@agent-kit`, then restart. The docs say auto-update is off by default for
  marketplaces that are not official. This repo needs no upgrade: it reads `main` in place.
- The repo changelog (`docs/changelogs/`) gets one entry per PR, as today; it is shown to the admin only.

## 5. Test plan

All tests run with `npm run test:unit` (vitest, no network, no model, no person), except the CLI job.

1. **Manifests.** For the marketplace and each plugin: required fields, kebab-case names, no reserved prefix,
   `./` sources that exist, no `..`, the same version in both files, `author`, `README.md`, `CHANGELOG.md` with a
   section for the current version, `network.hosts` present.
2. **Validator in CI.** A GitHub Actions job runs `claude plugin validate . --strict` and the same for each plugin,
   with the Claude Code CLI pinned to one version. Whether `validate` needs a login is not checked: the first build
   PR finds out. If it does, the job stays out and the manifest test is the gate; the PR says so.
3. **Forbidden strings.** Every file under `plugins/` and `.claude-plugin/` has none of: `x-thread-draft-tool`,
   `Shaked`, `thread draft`, `docs/plans/`, `docs/operations/`, `XT_`, and no `#` followed by digits other than the
   sample project's `#12` and `#34`. The list is in the test, not in a plugin.
4. **Golden fixtures.** Every template has a good fixture that passes and bad fixtures that fail for exactly the named
   rules (today's `tests/unit/reply-lint-golden.test.js`, moved). New: every rule the lint can report has at least
   one bad fixture, so nothing ships without lint and fixtures (#486 rule).
5. **Config.** No file gives the defaults; each key changes its rule (a name in `humans`, an `allowLines` pattern,
   `maxLineLength`, `changelogAreas`); a broken file gives exit 2 with the key name.
6. **Hook.** The present Stop hook tests (opt-in variable, pass, fail, `stop_hook_active`, not JSON) run against the
   plugin script. `hooks.json` uses `${CLAUDE_PLUGIN_ROOT}`; this repo's settings point into `plugins/`.
7. **Copy test.** The test copies `plugins/reply-style/` alone into a temp folder (what the cache gets) and runs the
   lint CLI and the hook from there, with a temp `.claude/agent-kit.json`. It proves no file above the plugin root
   is read.
8. **Install test.** In CI, with `CLAUDE_CONFIG_DIR` and the project in temp folders:
   `claude plugin marketplace add <checkout> --scope project`, `claude plugin install reply-style@agent-kit --scope project`,
   then `claude plugin list --json` shows it enabled at the manifest version. Same job as item 2.
9. **This repo.** `.claude/skills/reply-style` resolves to the plugin skill; `npm run docs:refresh` still lists it in
   `CLAUDE.md` (`scripts/update-claude-index.mjs` reads `isDirectory()` from a directory entry, which is false for
   a symlink, so the build PR fixes that); every existing reply-lint, janitor and changelog test passes unchanged
   except import paths.

## 6. Generic or specific: one row per piece

| Piece | Kind | Verdict | Why |
|---|---|---|---|
| `reply-style` skill and 5 templates (status report, owner question, handoff, owner action, incident) | skill | generic after cleaning | Names the owner, this repo's issues and paths; the rules themselves are general |
| `changelog-entry` template | template | stays here | Its Area list and the app page that shows entries are this app's; the plugin keeps the generic `--kind=changelog` check |
| `telegram-message` template | template | stays here | Tied to `scripts/notify-telegram.mjs` and the owner's Telegram decisions |
| `scripts/reply-lint.mjs` | script | generic after cleaning | Owner name, Area list and the net-lines line move to config |
| `scripts/reply-style-stop.mjs` and the Stop hook | hook | generic after cleaning | Only the message names the owner and the skill path |
| `scripts/reply-lint-comment.mjs` | script | generic after cleaning | Lints agent comments by the Claude Code footer; nothing app-specific but the import |
| `.github/workflows/reply-lint*.yml` | workflow | generic, as an example file | A plugin cannot install a workflow; shipped under `plugins/reply-style/examples/` |
| `scripts/changelog-check.mjs` | script | stays here | Checks this repo's `docs/changelogs/` rule |
| `task-janitor` skill, `scripts/janitor.mjs`, `sessions.schema.json` | skill, script | generic after cleaning | `REPO`, labels, markers and owner words move to config |
| `scripts/session-janitor.mjs` (#493) | script | generic after cleaning, after #493 merges | Same as the janitor |
| Status board command (#499) | command | generic after cleaning, after #499 merges | Not built yet (checked 2026-11-26: #499 open) |
| `agent-pr-workflow` skill and `scripts/agent-pr.sh` | skill, script | generic after cleaning | Branch, push, REST PR and check reading are general; the Vercel smoke part and the repo default stay here |
| `e2e-contract-tests` skill | skill | generic after cleaning, later | The method is general; it names this repo's helpers (`route()`, PGlite, test paths), which become examples |
| `product-care` skill | skill | stays here | Every fact is about this product's clients and platform |
| `high-risk-features`, `build-and-test`, `deploy-and-release`, `js-ts-quality` | skill | stays here | Short notes about this app's code and checks |
| `pstack-unslop`, `pstack-technical-writing`, `pstack-bro` | skill | third party, not republished | MIT by Lauren Tan (`THIRD_PARTY_LICENSES/pstack.md`); upstream is itself a plugin repo, https://github.com/cursor/plugins/tree/792440e8a560a4a3f63748cdee70491ecd412982/pstack. The plugin names writing skills through `writingSkills`; this repo keeps its copies |
| `scripts/update-claude-index.mjs`, `CLAUDE.md`, `AGENTS.md` | script, docs | stays here | This repo's own map and rules; they point to the plugins |

## 7. Build steps (task issues under #407)

Each step is one task issue with its full plan, one small PR per step, executor and validator named in the issue,
Opus judges every PR. The plugin folders are not part of the app build, so step 1 also adds `^plugins\/` and
`^\.claude-plugin\/` to the skip list in `scripts/vercel-ignore.mjs`, with a test. Opus validates that change,
because it decides when a deployment is created.

1. **Plugin `reply-style` and the marketplace file.** Move the skill, 5 templates, lint, Stop hook and comment lint
   into `plugins/reply-style/`; config file and defaults; this repo switches to the plugin by path (4.2); tests 1 to 9.
2. **Plugin `task-janitor`.** The janitor, the session janitor and the status board command, after #493 and #499 merge.
3. **Plugin `pr-workflow`.** The generic part of `agent-pr-workflow` and `agent-pr.sh`.
4. **Plugin `contract-tests`.** The `e2e-contract-tests` method with neutral examples.
5. **Docs.** `docs/marketplace.md` and a short README section: what is in it, config, how to contribute. Install
   commands and the announcement wait for the licence (section 2).

Not a step: the licence. It is the owner question on #502.
