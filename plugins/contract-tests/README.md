# contract-tests

A method for end-to-end contract tests of a server and the clients that talk to it, written so that they run in
ordinary continuous integration and on a laptop, with no person, no client binary, no browser sign-in and no paid
model call.

- **Skill `contract-tests`** (`skills/contract-tests/SKILL.md`): the method in nine steps, with neutral examples: a
  router function called in-process, an in-memory database, a scripted client that follows discovery, one test
  profile per client, a fetch guard, and the atomicity, idempotency, concurrency and conflict checks for each write.

The plugin ships no scripts, no hooks and no dependencies. It is text for an agent to follow; the tests are written
in the project that uses it. Your project keeps a short skill of its own for its helpers, its paths and its owner
rules, and links to this one.

## Install

```
/plugin marketplace add <owner>/<repository>
/plugin install contract-tests@agent-kit
```

## Settings

None.

## Changes

See `CHANGELOG.md`.
