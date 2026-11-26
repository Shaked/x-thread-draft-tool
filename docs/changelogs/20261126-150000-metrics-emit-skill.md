# Agents can join a metrics service with one skill

- A new plugin called metrics in the agent-kit marketplace has the skill metrics-emit: how a repository joins, the event shape, what never goes in.
- This repo reads the skill in place and has its own metrics settings.

Area: Docs
Link: https://github.com/Shaked/x-thread-draft-tool/issues/453

## Technical details

Central metrics M8 (#453), part 1. Plugin `metrics` 0.1.0 with `scripts/metrics-config.mjs` (four values in `.claude/agent-kit.json`), golden config fixtures and an install test. `scripts/plugin-cli-check.mjs` now accepts a plugin with no hooks.
