# Mobile width: the editor fits a phone, embeds cannot widen the page (epic #125)

## Problem
On a phone (390 px wide, 768 px and under), once embedded tweets load in the editor, the page becomes
about 690 px wide. The header is clipped and the content shifts. The cards also keep large side padding,
so the text column is narrow.

## Root causes
- An embedded tweet renders a 550 px iframe. Nothing in `.tweet-embed` limited it, so the page grew to fit it.
- The phone `.editor-header` used `margin: 0 -12px` with `width: 100vw` on desktop. Negative margins push it outside the screen.
- `.app` keeps its 15 px side padding, and `.editor-content` and `.thread-composer` add more on top.

## Changes (Task 1, W1, CSS only in `src/styles/App.css`)
1. Phone `.editor-header`: `margin: 0; width: auto;`. Desktop `.editor-header`: removed the unused `left: 0; right: 0`.
2. Inside `@media (max-width: 768px)`:
   - `.app:has(> .draft-editor) { padding-inline: 0; }`
   - `.editor-content { padding: 12px 0; }`
   - `.thread-composer { padding: 12px 6px; border-radius: 0; }`
   - `.tweet-embed { padding: 0; border: 0; min-height: 260px; }`
   - `.tweet-embed-loading { min-height: 260px; }`
3. All widths: `.tweet-embed { max-width: 100%; overflow: hidden; }` and
   `.tweet-embed :is(.twitter-tweet, iframe) { min-width: 0 !important; max-width: 100% !important; }`.
   The `.draft-editor { margin-inline: -15px }` fallback was not needed, because `:has()` works in Chromium.

## Test
`tests/e2e/editor-width.spec.ts` (chromium project, no person needed; the Twitter widget script is stubbed):
- 390 px: the document does not scroll sideways once a 550 px embed is loaded; the header is inside the screen;
  the post box is at least 92 % of the width; the iframe's right edge is inside the screen.
- 1280 px: the header and composer show, and there is no horizontal overflow.

Before the CSS change the 390 px test fails on the overflow check (scroll width 689 px, expected 390).

## Status
Task 1 (W1): this PR. Next tasks are not planned here yet.
