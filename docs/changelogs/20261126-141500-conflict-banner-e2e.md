# The edit conflict banner is now tested end to end

- A new browser test checks that when an AI app and you change the same post, you see the banner and your text is kept.

Area: Editor
Link: https://github.com/Shaked/x-thread-draft-tool/pull/0

## Technical details

`tests/e2e/draft-conflict-banner.spec.ts`: two writers, same post, banner, AI text stored, user text in the copy box. 8 of 8 local repeats passed. Implements #474 Task 2.
