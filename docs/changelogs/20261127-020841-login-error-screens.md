# Sign-in and error screens match the new look

- The sign-in page, the draft loading and error screens, and the shared preview's loading and error text use the new look.
- A screen for a signed-out visitor has no sign-out bar; the shared preview's error screen has a Back to Home button.

Area: Design
Link: https://github.com/Shaked/x-thread-draft-tool/pull/579

## Technical details

Task 11 of docs/plans/ui-design-system.md (#324). The sign-in page and the draft screens use src/ui components; the preview iframe's
inline style moved to src/components/PreviewFrame.css. PageHeader gained a `bar` prop (default true). The GitHub mark on the
sign-in button is dropped: the kit's icons are line icons.
