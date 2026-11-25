# Changelog entries

Every PR adds one file, `docs/changelogs/<UTC YYYYMMDD-HHMMSS>-<slug>.md` (`AGENTS.md`). The build reads the files into
`server/generated/changelog.js` (`scripts/build-info.mjs`). The admin sees them on the `/changelog` page and in the
`app_version` tool. Both show the title and the first three lines, cut at 280 characters.

## How to write an entry

Copy `.claude/skills/reply-style/templates/changelog-entry.md`:

```markdown
# <What changed, for a person, in 3 to 8 words>

- <What a person can now do or see, in one short line. The app shows this line first.>
- <A second change, only if there is one.>
```

Rules:
- The title says what changed for a person, in 3 to 8 words, in sentence case.
- Then 1 to 5 short lines. The most useful line goes first.
- Plain words only. No issue numbers, task ids, file names, code spans, model names or emoji.
- Say what a person can now do or see, not how it was built.

Example:

```markdown
# AI apps show only what your edit changed

- After an AI app edits a draft, its card shows the changed posts, each with its text before the edit.
- A button shows the whole thread.
```

Check the file before you commit it:

```sh
npm run reply-lint -- --kind=changelog docs/changelogs/<file>.md
```

## Old entries

159 of the 169 entries from 2026-11-11 to 2026-11-25 fail this check, and one more passes it but names a file
(checked on 2026-11-25). The plan for them is on task #369 (changelog and Telegram templates): a reviewed script
rewrites them and keeps the original text in each file, and the older entries stay as they are.

The same plan adds two lines to the template, `Area:` and `Link:`, together with the lint and the page that read them.
Do not add them by hand before that: today the page would show them as text.
