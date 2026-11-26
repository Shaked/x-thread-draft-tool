# Thread Composition

- Compose multi-post threads.
- Character counting for 280-char constraints. The count reads "120/280" and turns red with "(n over)" past the limit. With the Components flag on (Rare UI, the default for everyone; the admin can switch it off on Admin > Feature flags), the digits roll when they change (Rare UI's animated counter, `src/ui/Count.jsx`); the text for a screen reader is the same and it is not a live region, so it does not announce each keystroke.
- Thread numbering workflows.
- Emoji picker support.
- Embedded tweet support.
