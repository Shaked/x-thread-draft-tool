# Changelog check follow-up for the image tools

- No change for people using the app.

Area: Docs
Link: https://github.com/Shaked/x-thread-draft-tool/pull/623
Screenshot: not needed, docs only

## Technical details

Edit of #621's entry reverted: `scripts/changelog-check.mjs` allows a change to an existing entry only through a passing batch in `docs/changelog-rewrites/`, and a batch cannot add a `Screenshot:` line (`scripts/changelog-rewrite.mjs` keeps the base text under `## Technical details`). Gap and decision filed as #622.
