# Plan: a plugin marketplace of generic agent skills, commands and hooks

Issue: [#502 plugin marketplace](https://github.com/Shaked/x-thread-draft-tool/issues/502), epic
[#407 Epic 2](https://github.com/Shaked/x-thread-draft-tool/issues/407). Written 2026-11-26 by an Opus session (step 1 of the issue).
This file is the plan. Each build step in section 7 is its own task issue under #407, listed there.

## 1. Goal and limits

The owner asked (2026-11-26, #502): the skills, commands and hooks of this repo become a marketplace that other
projects can install; they become generic (nothing about this app); the reply templates come first.

Out of scope: the product (the app, its API and MCP server). The marketplace is developer tooling for agents that
work on a repository. It is not a product surface, so it gets no row in `docs/architecture/client-matrix.md`: no AI
app connected to the product sees it. Claude Code is the only client that installs these plugins; Codex and other
agents read the same files by path through `AGENTS.md` (section 4.2).

## 2. Licence

Decided by the owner on 2026-11-26: MIT ("Mit is fine", a comment on #502 at 07:15 UTC). Recorded on epic #407.

- Step 0 (section 7) adds `LICENSE` at the root with the MIT text and the line `Copyright (c) 2026 Shaked`
  (the GitHub login, the likelier reading; the owner can change the name in that PR).
- The same PR says in `README.md` and in `LICENSE` that `THIRD_PARTY_LICENSES/` keeps its own licences: pstack
  (MIT, Lauren Tan) and Rare UI in `src/ui/rare/` (MIT with Commons Clause and attribution). The root licence does
  not relicense them.
- Every `plugin.json` gets `"license": "MIT"`, and every plugin gets its own `plugins/<name>/LICENSE`, the same
  text as the root file. Reason: an installed plugin is a copy of its folder only ("Files outside the plugin
  directory aren't copied", section 3), and MIT asks for the notice in all copies. Test 1 checks that each plugin
  `LICENSE` equals the root `LICENSE`.
- Third-party content (pstack) is never republished in a plugin (section 6, row pstack).
- Until step 0 merges, no README install section and no announcement.

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
| `${CLAUDE_PLUGIN_ROOT}`: "Absolute path of the plugin's installed version"; it resolves in hook commands and "Anywhere in the Markdown body" of a plugin skill | manifest-reference, environment variables |
| `${CLAUDE_PLUGIN_ROOT}` "changes when the plugin updates, so don't write state there." | manifest-reference |
| Hooks file: "under a top-level `"hooks"` key, in the same shape as the `hooks` object in `settings.json`." | components |
| "A plugin's hooks don't wait for one of the plugin's skills or commands to be used." | components |
| Hook events: "`Stop` \| When Claude finishes responding". Plugin hooks: "When a plugin is enabled, its hooks merge with your user and project hooks." | [hooks](https://code.claude.com/docs/en/hooks.md) |
| "If you define the same handler in more than one settings file, it runs once. A plugin's or skill's copy of the same handler stays separate." | hooks, hook handler fields |
| Stop, exit 2: "Prevents Claude from stopping, continues the conversation". `stop_hook_active` "is `true` when Claude Code is already continuing as a result of a stop hook" | hooks, Stop decision control and Stop input |
| A plugin skill is invoked "as `/plugin-name:skill-name`"; a plugin skill and a project skill of the same name "Both load" | [skills](https://code.claude.com/docs/en/skills.md) |
| Install: `/plugin marketplace add owner/repo`, then `/plugin install <name>@<marketplace>`; shell: `claude plugin install <name>@<marketplace> --scope project` | [install](https://code.claude.com/docs/en/plugins/install.md), [cli-reference](https://code.claude.com/docs/en/plugins/cli-reference.md) |
| A committed `enabledPlugins` entry "turns the plugin on for your collaborators but doesn't download it to their machines. Each collaborator also runs `claude plugin install <name>@<marketplace> --scope project` once per clone." | install |
| "An Anthropic-hosted cloud session doesn't add the marketplaces a repository lists under `extraKnownMarketplaces`" | [loading](https://code.claude.com/docs/en/plugins/loading.md) |
| A plugin from a git marketplace is copied to `cache/<marketplace>/<plugin>/<version>/`; "Files outside the plugin directory aren't copied" | loading |
| A plugin from a marketplace added by local path "loads in place"; edits apply at the next session start or `/reload-plugins` | loading |
| Version: "Setting it keeps users on that version until you change it." Without one, a git source uses the commit sha | manifest-reference, loading |
| Plugin entries accept `dependencies`; the marketplace has `allowCrossMarketplaceDependenciesOn` | marketplace-reference |
| `claude plugin validate <path>` "is the authoritative check for a manifest"; `--strict` "Treat warnings as errors" | manifest-reference; `claude plugin validate --help`, checked here |
| `claude plugin tag` "Create a {name}--v{version} git tag for a plugin release, validating that plugin.json and any enclosing marketplace entry agree" | `claude plugin --help`, checked here |
| `--plugin-dir <path>`: load a plugin from a folder for one session only | cli-reference; `claude --help`, checked here |

Checked here with a throwaway marketplace in a temp folder (`CLAUDE_CONFIG_DIR` set to a temp folder):

- `claude plugin validate . --strict` passed a marketplace with one relative-path plugin once the marketplace had a
  `description` and the plugin had `author`, `README.md` and `network.hosts`. It listed the `Stop` hook and the
  skill. Missing icon, missing licence and a README without an install line are "plugin directory" checks: they
  print, but "do not change the result" unless `--profile directory` is given. CI does not use that profile.
- `claude plugin install reply-style --marketplace <folder> --scope user` installed it; `claude plugin list --json`
  showed `enabled: true` and the version; `claude plugin details reply-style@<marketplace>` listed
  `Skills (1) reply-style` and `Hooks (1) Stop`. No model call is needed for any of these.
- `claude plugin marketplace add ./ --scope project` writes the absolute path of the folder into
  `.claude/settings.json`. That path is wrong in every other clone, so this repo never commits that entry.
- A marketplace written into `.claude/settings.json` by hand did not show in `claude plugin marketplace list` in a
  non-interactive shell. The docs say project marketplaces need the workspace trust dialog. CI therefore installs at
  user scope with a temp `CLAUDE_CONFIG_DIR`.
- A project skill folder that is a symlink (`.claude/skills/x -> ../../plugins/demo/skills/x`) loaded: a headless
  `claude -p` run listed the skill by name.

Not checked: that a plugin `Stop` hook fires in a live session (the docs say it does; tests make no model call); which of the two loads when
a bare `/name` matches a plugin skill and a project skill; whether `claude plugin validate` works with no login
(this container has one).

## 4. Decisions

### 4.1 Layout and names
```
.claude-plugin/marketplace.json        marketplace "agent-kit": description, owner, one entry per plugin
plugins/<name>/.claude-plugin/plugin.json
plugins/<name>/README.md               what it does and its config keys; install lines live in docs/marketplace.md
plugins/<name>/CHANGELOG.md            one section per version
plugins/<name>/skills/<skill>/SKILL.md and templates/
plugins/<name>/commands/<command>.md   only where a skill does not fit
plugins/<name>/hooks/hooks.json        commands use "${CLAUDE_PLUGIN_ROOT}/scripts/..."
plugins/<name>/scripts/*.mjs           Node 20, no dependencies
plugins/<name>/fixtures/               golden fixtures, shipped as examples
plugins/<name>/examples/               files a plugin cannot install, such as GitHub workflows
```
- Marketplace name `agent-kit`: short, not reserved, no app or owner name. Its `owner.name` and each plugin's
  `author.name` are the owner's GitHub login: the publisher, the only place that name appears in `plugins/`.
- Plugin names: `reply-style`, `task-janitor`, `pr-workflow`, `contract-tests`. Installed names: `reply-style@agent-kit`.
- First version of each plugin: `0.1.0`. `1.0.0` comes when another project has used it for a week without a
  breaking change.
- Every relative source starts with `./`. A plugin never reads a path above its own root: the cache copy would not
  have it (section 3).
- How another project installs, after step 0: `/plugin marketplace add Shaked/x-thread-draft-tool`, then
  `/plugin install reply-style@agent-kit`. For a team: `claude plugin marketplace add Shaked/x-thread-draft-tool --scope project`
  (it commits a GitHub `extraKnownMarketplaces` entry, not a path), then `claude plugin install reply-style@agent-kit --scope project`.
  Cloud sessions: the install page says to add plugins at claude.ai; not checked.

### 4.2 One source of truth: this repo uses the plugin folders in place
The only copy of each plugin's files is under `plugins/<name>/`. This repo reads them by path:

- Skills: `.claude/skills/<skill>` is a symlink to `../../plugins/<name>/skills/<skill>`. Checked here: Claude Code
  loads a symlinked project skill. Codex and other agents follow the same path from `AGENTS.md`.
- Hooks: `.claude/settings.json` runs `node "$CLAUDE_PROJECT_DIR/plugins/reply-style/scripts/reply-style-stop.mjs"`.
- Scripts: `npm run reply-lint` runs the plugin script. `scripts/reply-lint.mjs` stays as a small wrapper, because
  `janitor.mjs`, `reply-lint-comment.mjs`, `changelog-check.mjs`, `reply-style-stop.mjs` and the tests import it,
  and `.github/workflows/reply-lint.yml` runs it by path. A bare re-export is not enough: the plugin script runs its
  CLI only when it is the entry file, so `node scripts/reply-lint.mjs bad.md` would exit 0 with no output. The
  wrapper re-exports the functions and calls the plugin's exported `main()` when it is run itself. A subprocess
  test runs `node scripts/reply-lint.mjs` on a bad fixture and expects exit 1 and the findings.
- Settings: this repo's values live in `.claude/agent-kit.json` (4.3).
- Skill text names its scripts relative to the skill folder (`../../scripts/reply-lint.mjs`), not with
  `${CLAUDE_PLUGIN_ROOT}`: that variable is not set when the skill loads as a project skill through the symlink.

Why not install the plugin in this repo: most sessions here are cloud sessions, and the docs say they do not add a
repository's `extraKnownMarketplaces`; a local-path marketplace entry holds an absolute path; and an installed copy
would be a second copy that lags behind `main`. Why not a copied folder with a "same content" test: two copies in
every diff. A symlink is one copy.

Risks, and what handles them:
- A Windows clone without symlink support sees a text file. This repo's agents run on Linux and macOS; written in
  `docs/marketplace.md`.
- An edit through the GitHub file API or web editor to `.claude/skills/reply-style/...` hits the symlink. Edits go
  to `plugins/reply-style/...` with a version bump. Step 1 writes this into `docs/operations/reply-style.md` and
  `docs/operations/weekly-review.md`, because the weekly review edits this skill.
- A person who also installs `reply-style@agent-kit` at user scope gets the skill twice and two Stop hooks here
  (the docs: a plugin's copy of a handler "stays separate").
  `docs/marketplace.md` says not to install it in this repo.
- Repo gates stop seeing the moved code: `COUNTED_DIRS` in `scripts/net-lines.mjs`, `SCAN_DIRS` in
  `scripts/slop-scan.mjs`, `knip.json` and the Node block of `eslint.config.js` cover `scripts/` only. Step 1b adds
  the prefix `plugins/` to `COUNTED_DIRS` (it matches with `startsWith`, so no glob) and `plugins/*/scripts/` to
  the other three, so a move does not hide about 300 lines and later growth is counted.

### 4.3 How generic is made: one config file per project
- No app name, owner name, issue number or repo path in any plugin text. Test 2 in section 5 enforces it.
- Project settings are in one file, `.claude/agent-kit.json`, with a top-level part and one section per plugin.
  A missing file or key means the default.
- The lint stays pure: `lint(text, options, config)`. Only the command-line scripts and the hook read the file.
  They find it at `$CLAUDE_PROJECT_DIR/.claude/agent-kit.json`, else by walking up from the working folder to the
  git root, or take `--config <file>`.
- A broken file (not JSON, or a key of the wrong type): the command-line lint stops with exit 2 and names the key.
  The Stop hook never does that, because exit 2 from a Stop hook keeps the turn from ending: it checks
  `stop_hook_active` first, then on a broken file prints a warning on stderr and exits 0.
- The skill text is static, so it tells the agent to read `.claude/agent-kit.json` for the owner name and the
  project templates. The scripts read the same file.
- Not used: `userConfig` in `plugin.json`. It is set per person at install time; these settings belong to the
  project and are committed.

Keys for step 1 (reply-style). The task-janitor keys are decided in its own task from the constants in
`scripts/janitor.mjs` (`REPO`, labels such as `held`, `owner`, `parked`, `cleanup`, `weekly`, `reply-style-fail`,
the markers `CLAIM`, `HANDOFF`, `RELEASE`, the owner words in `OWNER_QUESTION`, `IGNORED_FILES`, the limits).

```json
{
  "owner": "Sam",
  "ownerLogin": "sam-example",
  "repo": "acme/sample-app",
  "reply-style": {
    "humans": ["Sam", "the owner"],
    "allowLines": ["^Implements #\\d+ Task "],
    "maxLineLength": 160,
    "changelogAreas": ["Editor", "Docs"],
    "extraTemplates": { "changelog-entry": "docs/templates/changelog-entry.md" },
    "writingSkills": ["unslop"]
  }
}
```

| Key | Default | Used for |
|---|---|---|
| `owner` | `the owner` | The display name the skill tells the agent to use, and the Stop hook message |
| `ownerLogin` | the owner part of `repo` | Which GitHub author counts as the owner (janitor trust, comment lint) |
| `repo` | from `git remote get-url origin` | Links in examples and in janitor output |
| `reply-style.humans` | `[owner, "you", "the owner"]` | Words after "blocked on" and "waiting for" that mean a person |
| `reply-style.allowLines` | `[]` | Regular expressions for lines the lint skips, such as a required `Implements #12 Task 1` line |
| `reply-style.maxLineLength` | `160` | The `long-line` rule |
| `reply-style.changelogAreas` | `[]` (any one word) | The `Area:` line of `--kind=changelog` |
| `reply-style.extraTemplates` | `{}` | Project templates the skill lists next to its own (this repo: changelog entry, Telegram) |
| `reply-style.writingSkills` | `[]` | Writing skills the skill tells the agent to apply, by name (this repo: the pstack copies) |

Fixed, not configurable: the opt-in variable `REPLY_STYLE=owner`; the comment lint's Claude Code footer and its
`HANDOFF` and `Decision` markers. The three `--kind` shapes (reply, changelog, telegram) stay in the plugin lint as
generic shapes; the `Link:` line and `## Technical details` part of a changelog entry stay part of that shape.

Keys the issue named and the plan leaves out, with the reason:
- `languages`: the lint has English rules only. A key with one allowed value does nothing; it comes with a second
  rule set.
- Tracker issue: no reply-style rule needs it. The task-janitor task decides it (the queue issue).
- Link patterns: the label rule (`#12`, `Q1`) is generic and its links are checked by text, not by URL. Added when
  a project needs another label shape.

The templates and fixtures take their examples from a neutral sample project: `acme/sample-app`, owner "Sam",
issues `#12` and `#34`.

### 4.4 Plugins that use each other
`scripts/janitor.mjs` imports the reply lint to check recent HANDOFF comments. Plugins are cached apart and never
read above their root, so the `task-janitor` plugin cannot import the `reply-style` script by path. Decision: that
check is optional. The janitor reads `task-janitor.replyLint` from the config (a path to the lint module, in this
repo `plugins/reply-style/scripts/reply-lint.mjs`). Without it the report prints one line, "Reply style: not
checked (no replyLint in .claude/agent-kit.json)", and so does a path that does not exist. Tests cover all three.
In another project the installed reply-style plugin lives in a cache folder whose path has its version, so a
configured path breaks at each update and the line says "not checked"; that is accepted. The docs list `dependencies` for plugin
entries; whether a dependency gives a path to the other plugin is not checked, so it is not used.

### 4.5 Versions, changelog and upgrades
- `version` in `plugin.json` and in the marketplace entry, the same value (test 1; `claude plugin tag` also checks
  it). Semver: patch for wording, minor for a new rule, template or config key with a default, major for a removed
  or renamed key, template or rule. A stricter rule is minor, and its changelog line starts with "Stricter:".
- Because a set version pins users (section 3), every PR that changes files under `plugins/<name>/` bumps that
  plugin's version and adds a `CHANGELOG.md` section. The check works like `scripts/net-lines.mjs`: a pure function
  with fixture tests in the unit job, and the git diff in its own workflow with `fetch-depth: 0` (the unit job is a
  shallow, sharded checkout).
- Release tags: `claude plugin tag plugins/<name> --push` creates `<name>--v<version>`, after step 0.
- Upgrade for another project: `claude plugin marketplace update agent-kit`, then
  `claude plugin update reply-style@agent-kit`, then a restart. This repo needs no upgrade: it reads `main` in place.
- The repo changelog (`docs/changelogs/`) gets one entry per PR, as today; it is shown to the admin only.

## 5. Test plan

All tests run with `npm run test:unit` (vitest, no network, no model, no person), except the plugin CLI job (8).

1. **Manifests.** For the marketplace and each plugin: required fields, kebab-case names, no reserved prefix,
   `./` sources that exist, no `..`, the same version in both files, `author`, `description`, `README.md`,
   `CHANGELOG.md` with a section for the current version, `network.hosts`.
2. **Forbidden strings.** Every file under `plugins/` and `.claude-plugin/` has none of: `x-thread-draft-tool`,
   `Shaked`, `thread draft`, `docs/plans/`, `docs/operations/`, `XT_`, and no `#` followed by digits other than the
   sample project's `#12` and `#34`. The JSON manifests are parsed, and only `owner.name` and `author.name` are
   exempt, and so are the `plugins/*/LICENSE` files (their copyright line). The list is in the test, not in a plugin.
3. **Golden fixtures.** Every plugin template has a good fixture that passes and bad fixtures that fail for exactly
   the named rules. The `WANT` map and every rule assertion of `tests/unit/reply-lint-golden.test.js` are kept; the
   fixtures move into the plugin and their names change to the sample project. The changelog and Telegram fixtures
   stay in `tests/unit/` and run against the plugin lint with this repo's config, so all seven kinds stay covered.
   New: every rule the lint can report has at least one bad fixture (the #486 rule: nothing ships without lint and
   fixtures).
4. **Config.** No file gives the defaults; each key changes its rule; a broken file gives exit 2 and the key name.
5. **Hook.** The Stop hook tests (opt-in variable, pass, fail, `stop_hook_active`, not JSON) run against the plugin
   script, plus: a broken config gives exit 0 and a warning. `hooks.json` uses `${CLAUDE_PLUGIN_ROOT}`; this repo's
   settings point into `plugins/`.
6. **Copy test.** The test copies `plugins/reply-style/` alone into a temp folder (what the cache gets) and runs the
   lint CLI and the hook from there, with a temp `.claude/agent-kit.json`. It proves no file above the plugin root
   is read. It is the install test whenever job 8 cannot run.
7. **This repo.** `.claude/skills/reply-style` resolves to the plugin skill; `npm run docs:refresh` still lists it in
   `CLAUDE.md` (`scripts/update-claude-index.mjs` reads `isDirectory()` from a directory entry, which is false for a
   symlink, so step 1b fixes that); the janitor, comment lint and changelog check tests pass with only import paths
   changed. That holds only because `scripts/reply-lint.mjs` passes this repo's `.claude/agent-kit.json` to the
   pure lint: its default `humans` has no "Shaked", so "blocked on Shaked" would fail without it.
8. **Plugin CLI job.** A GitHub Actions job with the Claude Code CLI pinned to one version and a temp
   `CLAUDE_CONFIG_DIR`: `claude plugin validate . --strict`, the same for each plugin,
   `claude plugin install reply-style --marketplace "$GITHUB_WORKSPACE" --scope user`, then `claude plugin list --json`
   (enabled, manifest version) and `claude plugin details reply-style@agent-kit` (the skill and the `Stop` hook).
   If the CLI needs a login there, step 1 leaves the job out and says so in the PR; test 6 is then the gate. The
   job is never added with `continue-on-error`.

## 6. Generic or specific: one row per piece

| Piece | Kind | Verdict | Why |
|---|---|---|---|
| `reply-style` skill and 5 templates (status report, owner question, handoff, owner action, incident) | skill | generic after cleaning | Names the owner, this repo's issues and paths; the rules themselves are general |
| `changelog-entry` template | template | stays here | Its Area list and the app page that shows entries are this app's; the plugin keeps the generic `--kind=changelog` check |
| `telegram-message` template | template | stays here | Tied to `scripts/notify-telegram.mjs` and the owner's Telegram decisions; the plugin keeps the generic `--kind=telegram` check |
| `scripts/reply-lint.mjs` | script | generic after cleaning | Owner words, the Area list and the `Implements` line move to config |
| `scripts/reply-style-stop.mjs` and the Stop hook in `.claude/settings.json` | hook | generic after cleaning | Only the message names the owner and the skill path |
| `scripts/reply-lint-comment.mjs` | script | generic after cleaning | Lints agent comments by the Claude Code footer; nothing app-specific but the import |
| `.github/workflows/reply-lint.yml`, `reply-lint-comments.yml` | workflow | generic, as example files | A plugin cannot install a workflow; copies go to `plugins/reply-style/examples/`, this repo keeps its own |
| `docs/operations/reply-style.md` | docs | stays here | This repo's setup (opt-in, CI, janitor); the generic part becomes the plugin README |
| `scripts/changelog-check.mjs` | script | stays here | Checks this repo's `docs/changelogs/` rule |
| `task-janitor` skill, `scripts/janitor.mjs`, `sessions.schema.json` | skill, script | generic after cleaning | `REPO`, labels, markers and owner words move to config (4.3, 4.4) |
| `scripts/session-janitor.mjs` | script | generic after cleaning, after #493 closes | On `main` already; same cleaning as the janitor |
| `/janitor` command (#493) | command | generic after cleaning, after #493 closes | Not on `main` yet (checked 2026-11-26: no `.claude/commands/`) |
| Status board and `/status` command (#499) | command | generic after cleaning, after #499 closes | Not built yet (checked 2026-11-26: #499 open) |
| `agent-pr-workflow` skill and `scripts/agent-pr.sh` | skill, script | generic after cleaning | Branch, push, REST PR and check reading are general; the Vercel smoke part and the repo default stay here |
| `e2e-contract-tests` skill | skill | generic after cleaning, later | The method is general; it names this repo's helpers (`route()`, PGlite, test paths), which become examples |
| `product-care` skill | skill | stays here | Every fact is about this product's clients and platform |
| `high-risk-features`, `build-and-test`, `deploy-and-release`, `js-ts-quality` | skill | stays here | Short notes about this app's code and checks |
| `pstack-unslop`, `pstack-technical-writing`, `pstack-bro` | skill | third party, not republished | MIT by Lauren Tan (`THIRD_PARTY_LICENSES/pstack.md`). Upstream is https://github.com/cursor/plugins/tree/792440e8a560a4a3f63748cdee70491ecd412982/pstack, a Cursor plugin repo; whether Claude Code can install it is not checked. The plugin names writing skills through `writingSkills`; this repo keeps its copies |
| `scripts/update-claude-index.mjs`, `CLAUDE.md`, `AGENTS.md` | script, docs | stays here | This repo's own map and rules; they point to the plugins |

## 7. Build steps (task issues under #407)

One task issue per step, one small PR per step. Haiku executes every step (`AGENTS.md`); Sonnet takes a step over
only when Haiku fails the same step twice. Opus judges every PR. The plugin folders are not part of the app
build, so step 1a adds `^plugins\/` and `^\.claude-plugin\/` to the skip list in `scripts/vercel-ignore.mjs`, with
a test.

| Step | What | Executor, validator | Depends on |
|---|---|---|---|
| 0, #506 | `LICENSE` (MIT) at the root, the third-party note, `license` in manifests once they exist | Haiku, Opus | this plan |
| 1a, #507 | `.claude-plugin/marketplace.json`, an empty `plugins/reply-style/` with manifest, README and CHANGELOG, tests 1 and 2, the version check, `vercel-ignore` | Haiku, Opus | this plan |
| 1b, #508 | Move the reply-style skill, 5 templates, lint, Stop hook and comment lint into the plugin; config; this repo switches in place (4.2); tests 3 to 8; the gate updates | Haiku, Opus (hook and every reply check) | 1a |
| 2, #509 | Plugin `task-janitor`: janitor, session janitor, `/janitor`, status board | Haiku, Opus | #508, #493, #499 |
| 3, #510 | Plugin `pr-workflow`: the generic part of `agent-pr-workflow` and `agent-pr.sh` | Haiku, Sonnet | 1b |
| 4, #511 | Plugin `contract-tests`: the `e2e-contract-tests` method with neutral examples | Haiku, Sonnet | 1b |
| 5, #512 | `docs/marketplace.md` and a short README section: contents, install lines, config, how to contribute | Haiku, Sonnet | 0, 1b |

Task issues: #506 to #512, created with this plan on 2026-11-26. #502 closes when this plan merges.
