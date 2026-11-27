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

## Screenshots

A pull request that changes `src/` or `server/mcp/ui/` (a page a person sees) adds one screenshot to each entry it adds
(#603). Backend, test, doc and config changes need none.

- Put the line under `## Technical details`, as `Screenshot: img/<same name>.png` or `Screenshot: ![<text>](img/<same name>.png)`.
  The path is relative to the entry's folder. Any other link (`docs/changelogs/img/...`, a URL, a `../` path) fails the check.
- The PNG is at most 200 KB (exactly 200 KB passes), at device scale 2, from the pull request's own build. Take it with the
  `ui-debug` skill's script: `node scripts/ui-shot.mjs --user admin --routes <page> --widths 390 --scale 2 --out test-results/ui-shot`.
  It writes `test-results/ui-shot/<route>-390-light-en.png`: `/` becomes `home`, `/admin/users` becomes `admin-users`.
  Copy that file to `docs/changelogs/img/<same name>.png`. It needs the built app and the local API (see the skill).
- A visible change that needs no picture says `Screenshot: not needed, <reason>` on that line instead. A bare `not needed` fails.
- `scripts/changelog-check.mjs` checks this and prints the missing or broken line, file or size.

## Old entries

Entries from before the template change have no `Area:` and `Link:` lines. The page shows them under "Earlier changes
(original text)". Their text stays as it is, except through a reviewed batch (task #369, steps 2 to 6).

A batch is a JSON array in `docs/changelog-rewrites/batch-<NN>.json`. Each item has `file`, `pr` (the pull request
address), `area` (from the Area list), `title` and `lines` (1 to 5 short lines). The script
`scripts/changelog-rewrite.mjs` rewrites each entry dated from 2026-11-11 on:

```sh
node scripts/changelog-rewrite.mjs docs/changelog-rewrites/batch-01.json           # dry run: prints the plan, writes nothing
node scripts/changelog-rewrite.mjs --write docs/changelog-rewrites/batch-01.json   # writes; a second run changes nothing
node scripts/changelog-rewrite.mjs --check docs/changelog-rewrites/batch-01.json   # exit 0 when each file is what --write makes
```

The rewritten file keeps its original text, byte for byte, under `## Technical details`. `--check` takes that original
from the history of the base branch: the newest version of the file there without the `## Technical details` heading. CI (`scripts/changelog-check.mjs`) lets a pull request change an existing
entry only when a batch in the same pull request passes `--check`. A deleted entry always fails the check.
Do not change an old entry by hand.
