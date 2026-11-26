# Changelog

## 0.2.2

- The lint reports `session-link`: a "Waiting for" item that names a session needs its session link. `RULES` lists every rule name.
- `--config <file>` with a file that does not exist exits 2 and prints the path; it no longer falls back to the defaults.
- A line matched by `allowLines` skips only the label and word checks; option letters, length, emoji and filler are still checked on it.
- `--config` with no path exits 2. The hook warning now says the check was skipped.
- `main()` is exported from the lint, the Stop hook and the comment lint, so a project can wrap them.

## 0.2.1

- The plugin folder has a LICENSE file (MIT), a copy of the repository licence.

## 0.2.0

- The reply-style skill and its five templates (status report, owner question, handoff, owner action, incident).
- The reply lint reads `.claude/agent-kit.json` for the owner's name, the humans, the allowed lines, the line length, the changelog areas and the project templates.
- A Stop hook checks the reply at the end of each turn when `REPLY_STYLE=owner` is set.

## 0.1.0

- Empty plugin shell: manifest, README and changelog.
