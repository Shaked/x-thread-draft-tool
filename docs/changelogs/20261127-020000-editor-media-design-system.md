# Editor images, tweet embed and emoji picker use the new design

- The image carousel, the image drop area, the tweet URL box and the emoji picker now use the same colours, buttons and spacing as the rest of the app. The carousel's previous and next buttons are larger and easier to press.
- Adding, pasting or removing images, the carousel, the tweet embed and inserting emoji work as before.

Area: Design
Link: https://github.com/Shaked/x-thread-draft-tool/pull/PENDING

## Technical details

Plan `docs/plans/ui-design-system.md` Task 10 (#328). `ImageCarousel.jsx` moved out of `PostBox.jsx` with `ImageCarousel.css`; `ImageUpload.css`, `TweetEmbed.css` and `EmojiPicker.css` are new; the old rules left `src/styles/App.css`. `ImageUpload.jsx` left the token-lint `LEGACY` list. New tokens in `tokens.css`: `--media-frame-min/max`, `--embed-min`, `--blur-overlay`. `Icon` gains `prev` and `next`; `IconButton` gets `mirror`, `Input` gets `autoFocus`.
