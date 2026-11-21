## TL;DR
Unit tests in CI now run in two parallel parts, so the draft list redesign can merge next. The app shell redesign starts after it.
Nothing needed from you.

## What you need to do
Nothing.

## Waiting for
- [PR #344 draft list redesign](https://github.com/Shaked/x-thread-draft-tool/pull/344), for
  [#322 draft list on design system](https://github.com/Shaked/x-thread-draft-tool/issues/322): its session merges `main`
  into `claude/ui-draft-list`, so the unit check runs in two parts. Then it merges when CI is green and checks production.
  Expected: not known.
- [#323 app shell redesign](https://github.com/Shaked/x-thread-draft-tool/issues/323) (menu drawer, phone bar, theme setting):
  starts after PR #344 ships. Expected: not known.

## Blocked on you
Nothing.

## Done
- [PR #347 unit tests in two shards](https://github.com/Shaked/x-thread-draft-tool/pull/347), for
  [#312 split the unit test job](https://github.com/Shaked/x-thread-draft-tool/issues/312): the unit check runs as two parts
  with a 45 s limit each, under the same check name `Unit tests (vitest)`. The 70 s limit for a whole run is the same.
  Merged at 08:30 UTC, checked.
  Tests: 22.2 s and 19.4 s per part locally, from the PR (not checked on CI) | Production: not checked.

## Details
- PR #344 failed only on the old 70 s limit: 72.5 s and 74.7 s, from
  [the 07:09 UTC status on #322](https://github.com/Shaked/x-thread-draft-tool/issues/322#issuecomment-7059073254), checked.
- The [unit time limit question on #273](https://github.com/Shaked/x-thread-draft-tool/issues/273#issuecomment-7058464167)
  said a speed-up from the speed plan comes first. PR #347 is that speed-up. Whether the question is closed: not checked.
