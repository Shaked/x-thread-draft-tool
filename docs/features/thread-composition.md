# Thread Composition

- Compose multi-post threads.
- Character counting for 280-char constraints. The count reads "120/280" and turns red with "(n over)" past the limit. With the Components flag on (Rare UI, the default for everyone; the admin can switch it off on Admin > Feature flags), the digits roll when they change (Rare UI's animated counter, `src/ui/Count.jsx`); the text for a screen reader is the same and it is not a live region, so it does not announce each keystroke.
- Thread numbering workflows.
- Emoji picker support.
- Embedded tweet support. When an embedded link is not a tweet or the widget fails, the error shows "View tweet on X/Twitter" as an underlined link at least 44 px tall (in the light look the accent equals the body text, so the underline marks it as a link).
