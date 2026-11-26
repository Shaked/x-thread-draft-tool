# Changelog entries

Every PR adds one file, `docs/changelogs/<UTC YYYYMMDD-HHMMSS>-<slug>.md` (`AGENTS.md`). The build reads the files into
`server/generated/changelog.js` (`scripts/build-info.mjs`). The admin sees them on the `/admin/changelog` page (#484) and in the
`app_version` tool. Both show the title and the first three lines, cut at 280 characters.

## How to write an entry

Copy `.claude/reply-style-templates/changelog-entry.md`:

```markdown
# <What changed, for a person, in 3 to 8 words>

- <What a person can now do or see, in one short line. The app shows this line first.>
- <A second change, only if there is one.>

Area: <one word from the Area list>
Link: <the pull request address, starting with https://>

## Technical details

<Optional. Files, tests and reasons for a maintainer.>
```

Rules:
- The title says what changed for a person, in 3 to 8 words, in sentence case.
- Then 1 to 5 short lines. The most useful line goes first. The page and the app show these lines.
- `Area:` is one word from this list: Drafts, Editor, AI apps, Admin, Design, Speed, Security, Docs. The page groups
  the entries by it.
- `Link:` is the address of the pull request. It starts with `https://`. The page links to it.
- Plain words only in the lines above `## Technical details`. No issue numbers, task ids, file names, code spans,
  model names or emoji. The Technical details part may hold file names and code.
- Say what a person can now do or see, not how it was built.

Example:

```markdown
# AI apps show only what your edit changed

- After an AI app edits a draft, its card shows the changed posts, each with its text before the edit.
- A button shows the whole thread.

Area: AI apps
Link: https://github.com/Shaked/x-thread-draft-tool/pull/430

## Technical details

Card diff in the MCP draft view, `server/mcp/ui/`.
```

Check the file before you commit it:

```sh
npm run reply-lint -- --kind=changelog docs/changelogs/<file>.md
```

CI (`.github/workflows/changelog-check.yml`, `scripts/changelog-check.mjs`) runs the same check on every added file,
and fails a pull request that changes or deletes an existing entry.

## Old entries

Entries from before the template change have no `Area:` and `Link:` lines. The page shows them under "Earlier changes
(original text)". Their text stays as it is. Task #369 plans a reviewed script to rewrite the entries from
2026-11-11 on (steps 2 to 6). Until then, do not change an old entry by hand.
