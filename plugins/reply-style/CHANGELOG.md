# Changelog

## 0.2.1

- The plugin folder has a LICENSE file (MIT), a copy of the repository licence.

## 0.2.0

- The reply-style skill and its five templates (status report, owner question, handoff, owner action, incident).
- The reply lint reads `.claude/agent-kit.json` for the owner's name, the humans, the allowed lines, the line length, the changelog areas and the project templates.
- A Stop hook checks the reply at the end of each turn when `REPLY_STYLE=owner` is set.

## 0.1.0

- Empty plugin shell: manifest, README and changelog.
