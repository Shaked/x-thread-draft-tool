# The admin menu is easier to read

- The admin menu marks the open page, and its rows start at the edge. On a phone it takes three rows, not six.
- The users and audit log filters no longer have large empty gaps, and phone table captions use the full width.
- A wide table, such as the users list, scrolls inside its column instead of the whole page.

Area: Admin
Link: https://github.com/Shaked/x-thread-draft-tool/pull/557

## Technical details

`src/ui/SideLayout.css` (a side menu: start-aligned rows, two columns under 768 px), `Button.css` (ghost `aria-current="page"`),
`Field.css` (the row basis only inside `Inline`), `Table.jsx` and `Table.css` (a scrolling region for wide tables, block caption on phones). The UI audit adds the admin menu case,
one marked entry on every admin page, and no field taller than its content (#551).
