# Rare UI delete button behind the flag

- With the Components switch on, Delete draft becomes the Rare UI delete button: press it, then confirm or cancel right there.
- It asks the same question as before, and Escape keeps the draft.

Area: Design
Link: https://github.com/Shaked/x-thread-draft-tool/pull/494

## Technical details

Rare UI delete-button copied into src/ui/rare/DeleteButton.jsx (upstream 0e9f0ef), motion 12.43.0 (lazy chunk only), wrapper src/ui/DeleteButton.jsx; DraftList uses it.
