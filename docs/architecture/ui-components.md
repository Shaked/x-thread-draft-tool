# UI components

The living list of the shared components in `src/ui/` (plan `docs/plans/ui-design-system.md`, section 3).
Pages only compose these and pass props. They take no `className`, and pages have no CSS of their own.
`tests/unit/ui-components.test.js` checks this file against `src/ui/`: every `## <Name>` below is a file in `src/ui/`, every
file has a section, a `Status:` line (`built`, or `not built:` with a reason), a props table and an example.

Some components have a second implementation behind the Components feature flag (`xt-kit`, `src/utils/skin.js`): real Rare UI components copied into `src/ui/rare/` (licence in `THIRD_PARTY_LICENSES/rare-ui.md`). They are styled only with Tailwind utilities that take token values (`src/styles/rare-kit.css`; the token lint checks their class strings) and load in their own chunk. The wrapper in `src/ui/` keeps our props, so pages do not change. Files in `src/ui/rare/` have no section of their own; their wrapper's section names them.

## Icon
- File: `src/ui/Icon.jsx`
- Status: built
- Props:

| Prop | Type | Default | Notes |
|---|---|---|---|
| `name` | `share` \| `agent` \| `x` \| `export` \| `publish` \| `signout` \| `menu` \| `close` \| `chevron` \| `drag` \| `image` \| `link` \| `emoji` \| `plus` | required | Line icon from one set. |
| `size` | `md` \| `lg` | `md` | 20 px or 24 px (`--icon-size`, `--icon-size-lg`). |
| `mirror` | boolean | `false` | Flips the icon in right-to-left text (arrows, chevrons). |

- States: none. Drawn in the current text colour; decorative (`aria-hidden`).
- Example: `<Icon name="menu" />`

## Page
- File: `src/ui/Page.jsx`
- Status: built
- Props:

| Prop | Type | Default | Notes |
|---|---|---|---|
| `width` | `narrow` \| `default` \| `wide` | `default` | 640, 880 or 1200 px (`--page-w-narrow`, `--page-w`, `--page-w-wide`). |
| `children` | node | | One `Page` per route. |

- States: centred; gutter 16 px, 24 px from 768 px; top padding 24 px.
- Example: `<Page width="narrow"><PageHeader title="About" /></Page>`

## PageHeader
- File: `src/ui/PageHeader.jsx`
- Status: built
- Props:

| Prop | Type | Default | Notes |
|---|---|---|---|
| `title` | string | | The `h1`. |
| `subtitle` | string | | Soft text under the title. |
| `back` | `{ to, label }` | | A ghost button that links back. |
| `actions` | node | | Goes into the AppBar (header from 768 px, bottom bar on phones). |
| `menu` | boolean | `true` | Shows the menu button. |
| `sticky` | boolean | `false` | Stays at the top while the page scrolls, with a bottom border. |
| `titleSlot` | node | | Replaces the `h1` (for example the editor's title input). |
| `status` | node | | Shown below the title (for example the editor's save status). |

- States: `sticky` keeps the header at `--z-sticky`. Title 24 px, 28 px from 768 px. Minimum height 64 px.
- Example: `<PageHeader title="Changelog" subtitle="Version 1.2, deployed today" back={{ to: '/', label: '← Back to drafts' }} />`

## Section
- File: `src/ui/Section.jsx`
- Status: built
- Props:

| Prop | Type | Default | Notes |
|---|---|---|---|
| `title` | string | required | The heading. The section is labelled by it. |
| `description` | string | | Soft text under the heading. |
| `actions` | node | | Shown at the end of the heading row. |
| `children` | node | | The content, 16 px apart. |
| `headingLevel` | 2 \| 3 \| 4 | `2` | Heading size: 20, 18 or 16 px. |

- States: none. The section is a `region` labelled by its heading.
- Example: `<Section title="Server" description="The version the server runs now.">…</Section>`

## Card
- File: `src/ui/Card.jsx`
- Status: built
- Props:

| Prop | Type | Default | Notes |
|---|---|---|---|
| `children` | node | | |
| `padding` | `md` \| `none` | `md` | `md` is the card padding (16, 20 from 768 px). |
| `tone` | `default` \| `raised` | `default` | `raised` uses the raised surface and a small shadow. |

- States: a heading inside a card is 18 px, semibold.
- Example: `<Card><h3>Fixed the editor</h3><p>Saved on every change.</p></Card>`

## Stack
- File: `src/ui/Stack.jsx`
- Status: built
- Props:

| Prop | Type | Default | Notes |
|---|---|---|---|
| `gap` | `1` \| `2` \| `3` \| `4` \| `6` \| `8` | `3` | A space token step (4 px grid). |
| `as` | element name | `div` | The element to render. |
| `children` | node | | |

- States: none. A column. The only way to space siblings vertically.
- Example: `<Stack gap={4}>…</Stack>`

## Inline
- File: `src/ui/Inline.jsx`
- Status: built
- Props:

| Prop | Type | Default | Notes |
|---|---|---|---|
| `gap` | `1` \| `2` \| `3` \| `4` \| `6` \| `8` | `2` | A space token step. |
| `align` | `start` \| `center` \| `end` \| `between` | `start` | Along the row. |
| `wrap` | boolean | `true` | Children wrap onto a new line. |
| `equal` | boolean | `false` | Every child gets the same width (a group of choices). |

- States: none.
- Example: `<Inline align="end" equal>…</Inline>`

## Button
- File: `src/ui/Button.jsx`
- Status: built
- Props:

| Prop | Type | Default | Notes |
|---|---|---|---|
| `variant` | `primary` \| `secondary` \| `ghost` \| `danger` \| `danger-quiet` | `secondary` | One `primary` per screen. |
| `size` | `sm` \| `md` \| `lg` | `md` | 36 (44 on touch), 44 or 52 px high. |
| `icon` | icon name | | Shown before the label. |
| `loading` | boolean | `false` | Same width; a spinner replaces the icon; clicks ignored; `aria-busy`. |
| `loadingLabel` | string | the label | Shown while loading. |
| `disabled` | boolean | `false` | Native disabled. |
| `disabledReason` | string | | Keeps the button focusable (`aria-disabled`) and shows the reason as help text. |
| `fullWidth` | boolean | `false` | Full width of its container. |
| `type` | `button` \| `submit` \| `reset` | `button` | |
| `to` | route | | Renders a link that looks like a button. |
| `href` | URL | | Renders an anchor that looks like a button. |
| `ariaLabel` | string | | The accessible name when the visible label is not enough (for example "Revoke access for <app>"). |
| `title` | string | | The tooltip. A `disabledReason` takes its place. |
| `haspopup` | `menu` | | The button opens a menu: sets `aria-haspopup`. Used by `Menu`. |
| `expanded` | boolean | | Whether that menu is open: sets `aria-expanded`. |
| `controls` | string | | The `id` of the menu it opens: sets `aria-controls`. |
| `ariaCurrent` | `page` | | Marks the link of the open page: sets `aria-current`; a ghost button gets the soft accent background (#551). |
| `onClick` | function | | |

- States: default, hover (only where hover exists), pressed (scale 0.98), focus-visible (the base focus ring), disabled (half opacity), loading, disabled with reason.
- Example: `<Button variant="primary" onClick={save}>Save</Button>`

## IconButton
- File: `src/ui/IconButton.jsx`
- Status: built (used by the editor posts, Task 9)
- Props:

| Prop | Type | Default | Notes |
|---|---|---|---|
| `icon` | icon name | required | |
| `label` | string | required | `aria-label` and the tooltip. |
| `variant` | `ghost` \| `secondary` | `ghost` | |
| `pressed` | boolean | | A toggle: sets `aria-pressed` and shows the pressed colour. |
| `expanded` | boolean | | A disclosure button (the menu): sets `aria-expanded`. |
| `controls` | string | | The `id` of the element it opens: sets `aria-controls`. |
| `disabled` | boolean | `false` | |
| `disabledReason` | string | | As in Button. |
| `handleProps` | object | | Spread on the `button` before the props above (a drag handle's dnd-kit listeners and attributes). |
| `onClick` | function | | |
| `ref` | ref | | Forwarded to the `button`, so a caller can return focus to it (the menu does). |

- States: always 44 x 44. Hover, pressed, focus-visible, disabled, pressed.
- Example: `<IconButton icon="menu" label="Menu" onClick={open} />`

## Menu
- File: `src/ui/Menu.jsx` (+ `Menu.css`)
- Status: built
- Props:

| Prop | Type | Default | Notes |
|---|---|---|---|
| `trigger` | `{ label, icon?, variant, disabled?, loading?, title? }` | required | The button that opens the menu; `icon` is an `Icon` name; the other fields go to `Button`. |
| `items` | `[{ label, onSelect, tone?, description? }]` | required | One `menuitem` each. `tone: 'danger'` colours the label; `description` is soft text under it. |
| `title` | string | | Soft heading above the list (for example "Link valid for"); names the menu. Without it the menu is named by the trigger's label. |

- States: from 768 px a popover 8 px under the trigger, aligned to its inline end, `--menu-w` wide. Below 768 px a sheet fixed above the phone bar. Opening moves focus to the first item. Arrow keys move (wrapping), Home and End jump to the ends, Tab moves on and closes it (focus leaving the menu closes it), and a press outside closes it, Escape closes and gives focus back to the trigger. The trigger has `aria-haspopup="menu"` and `aria-expanded`.
- Example: `<Menu trigger={{ label: 'Export', icon: 'export', variant: 'secondary' }} items={[{ label: 'Copy thread', onSelect: copy }]} />`

## Banner
- File: `src/ui/Banner.jsx`
- Status: built
- Props:

| Prop | Type | Default | Notes |
|---|---|---|---|
| `tone` | `info` \| `success` \| `warning` \| `danger` | `info` | Soft background and a border in the tone colour. |
| `title` | string | | Bold first line. |
| `children` | node | | The message. The text colour never changes with the tone. |
| `actions` | node | | Buttons at the end. |
| `role` | `status` \| `alert` \| `none` | `status` | Use `alert` for errors and `none` for a static note (no live region). |

- States: none. The tone is also said in the words of the message (colour is never the only signal).
- Example: `<Banner tone="danger" role="alert">Could not load the changelog.</Banner>`

## DescriptionList
- File: `src/ui/DescriptionList.jsx`
- Status: built
- Props:

| Prop | Type | Default | Notes |
|---|---|---|---|
| `items` | `[{ term, value }]` | required | `value` is text or a node. |
| `columns` | `1` \| `2` | `1` | `2` puts pairs side by side from 768 px. |

- States: the term is soft text; a long value breaks anywhere.
- Example: `<DescriptionList items={[{ term: 'Commit', value: sha }]} />`

## Skeleton
- File: `src/ui/Skeleton.jsx`
- Status: built
- Props:

| Prop | Type | Default | Notes |
|---|---|---|---|
| `lines` | number | `3` | Number of bars. |
| `variant` | `text` \| `row` \| `card` | `text` | Bar height: text line, a control row, a card. |

- States: shimmer; the shimmer stops under reduced motion (its time is 0 in the tokens). `aria-busy` is set; one "Loading…" text is read by screen readers.
- Example: `<Skeleton variant="card" lines={2} />`

## Field
- File: `src/ui/Field.jsx`
- Status: built
- Props:

| Prop | Type | Default | Notes |
|---|---|---|---|
| `label` | string | required | Shown above the control, 14 px semibold, linked to it. |
| `help` | string | | Soft text under the control; linked as its description. |
| `error` | string | | Danger text under the control; the control gets `aria-invalid`. |
| `children` | one control | required | An `Input` or a `Select`. They read the id and state from the Field. |

- States: label above the control; in a row (`Inline`) from 600 px a Field takes its share of the row, under 600 px it takes the full width. In a column it is as tall as its content (#551).
- Example: `<Field label="Token name"><Input value={name} onChange={setName} /></Field>`

## Input
- File: `src/ui/Input.jsx`
- Status: built
- Props:

| Prop | Type | Default | Notes |
|---|---|---|---|
| `value` | string | required | The text. |
| `onChange` | function | required | Gets the new text, not the event. |
| `type` | string | `text` | |
| `placeholder` | string | | Soft text; never the only label. |
| `maxLength` | number | | |
| `dir` | `auto` \| `ltr` \| `rtl` | `auto` | Typed Hebrew runs right to left. |
| `disabled` | boolean | `false` | Half opacity, `not-allowed`. |
| `ariaLabel` | string | | The accessible name, when there is no `Field` label (the editor's title). |

- States: hover (only where hover exists), focus (accent border; the focus ring is the base one), invalid (inside a Field with `error`), disabled. 44 high, 16 px text.
- Example: `<Input value={name} maxLength={100} onChange={setName} />`

## Select
- File: `src/ui/Select.jsx`
- Status: built
- Props:

| Prop | Type | Default | Notes |
|---|---|---|---|
| `value` | string | required | The value of the chosen option (text). |
| `onChange` | function | required | Gets the chosen value as text. |
| `options` | `[{ value, label }]` | required | `value` is text. |
| `disabled` | boolean | `false` | |

- States: the same as Input. A native select, so phones keep their own picker.
- Example: `<Select value="7" options={[{ value: '7', label: '7 days' }]} onChange={setDays} />`

## CodeBlock
- File: `src/ui/CodeBlock.jsx` (also exports `CopyButton`: `text`, `label`, `onFail`; a secondary small button that says "Copied!" or "Copy failed")
- Status: built
- Props:

| Prop | Type | Default | Notes |
|---|---|---|---|
| `code` | string | required | Shown in mono text, left to right. Long values break anywhere. |
| `copyLabel` | string | | When set, a Copy button with this label sits at the end (under the text on phones). |
| `onCopyFail` | function | | Called when the clipboard refuses; the page says what to do by hand. |

- States: copy shows "Copied!" for the click or "Copy failed". The copy button is a `Button`, so it keeps touch and focus rules.
- Example: `<CodeBlock key={token} code={token} copyLabel="Copy" onCopyFail={() => setFailed(true)} />`

## List
- File: `src/ui/List.jsx` (also exports `ListItem`)
- Status: built
- Props (`List`):

| Prop | Type | Default | Notes |
|---|---|---|---|
| `children` | `ListItem` elements | required | Rows with 1 px dividers. Put the list in a `Card` with `padding="none"`. |

- Props (`ListItem`):

| Prop | Type | Default | Notes |
|---|---|---|---|
| `title` | string | required | 18 px semibold; `dir="auto"` for user text. |
| `to` | string | | A route. The title becomes a link and the whole row is clickable; the actions keep their own buttons (stretched link). |
| `meta` | node[] | `[]` | Soft 14 px text items with 12 px gaps (no separators). |
| `badge` | node | | A `Badge`, shown beside the title. |
| `actions` | node | | Buttons at the end of the row; under them on phones. |
| `children` | node | | More content under the meta (for example a `CodeBlock`). |

- States: a row with `to` gets a hover background and a focus ring around the row when its link has keyboard focus. Under 600 px the actions take their own row, end-aligned.
- Example: `<List><ListItem title={token.name} meta={['Created Nov 1']} badge={<Badge>Active</Badge>} /></List>`
- Link row example: `<ListItem title={draft.title} to={`/draft/${draft.id}`} actions={<Button variant="ghost" size="sm">Duplicate</Button>} />`

## Badge
- File: `src/ui/Badge.jsx`
- Status: built
- Props:

| Prop | Type | Default | Notes |
|---|---|---|---|
| `tone` | `accent` \| `neutral` \| `success` \| `warning` \| `danger` | `neutral` | A soft background and its text colour. |
| `children` | string | required | The word; never colour alone. |
| `live` | boolean | `false` | Wraps the badge in `role="status"` so a change is announced. |

- States: none. 12 px semibold, full radius.
- Example: `<Badge tone="success">Active</Badge>`

## Dialog
- File: `src/ui/Dialog.jsx` (also exports `ConfirmProvider` and `useConfirm`)
- Status: built
- Props:

| Prop | Type | Default | Notes |
|---|---|---|---|
| `open` | boolean | required | Renders nothing when `false`. |
| `onClose` | function | | Called by Escape and the scrim. |
| `title` | string | required | The `h2`; names the dialog. |
| `description` | string | | Soft text under the title; linked as the description. |
| `children` | node | | More content between the text and the buttons. |
| `actions` | `[{ label, variant, onClick, autoFocus }]` | `[]` | Buttons; the one with `autoFocus` gets focus first. Under 600 px they stack, the last one on top. |
| `dismissible` | boolean | `true` | `false` ignores Escape and the scrim. |
| `returnTo` | ref | | Where focus goes on close. Default: the element that had focus when it opened. |
| `placement` | `center` \| `sheet-start` | `center` | `sheet-start` is the menu drawer: a full-height panel on the inline start edge, `--drawer-w` wide, mirrored under RTL. |
| `id` | string | | Set on the panel (the menu uses it for `aria-controls`). |

- States: rendered in a portal on `document.body`; `#root` is `inert` and the page does not scroll while open; Tab stays inside; Escape and the scrim close it; focus returns to the opener. Centred from 600 px, a bottom sheet below. `useConfirm()` returns `confirm({ title, body, confirmLabel, tone })`, which resolves `true` for the confirm button and `false` for Cancel, Escape or the scrim; a `danger` tone focuses Cancel. `ConfirmProvider` sits above the routes in `App.jsx`.
- Example: `<Dialog open={open} onClose={close} title="Delete?" actions={[…]} />`; to ask: `if (!(await ask({ title: 'Delete this draft?', body: 'Are you sure you want to delete this draft?', confirmLabel: 'Delete draft', tone: 'danger' }))) return`

## SegmentedControl
- File: `src/ui/SegmentedControl.jsx` (+ `SegmentedControl.css`)
- Status: built (the theme choice in the menu drawer)
- Props:

| Prop | Type | Default | Notes |
|---|---|---|---|
| `legend` | string | required | The fieldset legend, shown above the segments. |
| `value` | string | required | The checked option's value. |
| `options` | `[{ value, label }]` | required | One segment each. |
| `onChange` | function | required | Called with the new value. |
| `orientation` | `row` \| `column` | `row` | `column` stacks the segments (inside the drawer). |

- States: a radio group with native radios, so the arrow keys move between segments; each segment is at least 44 px high; the focus ring shows on the segment; the checked segment has the accent soft background.
- Example: `<SegmentedControl legend="Theme" orientation="column" value={value} onChange={setValue} options={[{ value: 'light', label: 'Light' }]} />`

## Toast
- File: `src/ui/Toast.jsx` (exports `ToastProvider` and `useToast`)
- Status: built
- Props:

| Prop | Type | Default | Notes |
|---|---|---|---|
| `message` | string | required | Argument of `toast({ message, tone })`. |
| `tone` | `neutral` \| `success` \| `danger` | `neutral` | `danger` uses `role="alert"` and stays until closed. |
| `children` | node | | `ToastProvider` only: wrap the routes, so a toast survives a navigation. |

- States: one toast at a time, above the phone bar; success and neutral go away after 4 s; danger has a Close button. The two live regions are mounted empty at start.
- Example: `<ToastProvider>…</ToastProvider>`; to show one: `toast({ message: 'Thread copied!', tone: 'success' })`

## Tabs
- File: `src/ui/Tabs.jsx`
- Status: built
- Props:

| Prop | Type | Default | Notes |
|---|---|---|---|
| `label` | string | required | The tab list's accessible name. |
| `tabs` | `[{ id, label, count? }]` | required | One tab each. A `count` is shown as " (3)" in soft text, so the name stays "Drafts (3)". |
| `value` | string | required | The `id` of the selected tab. |
| `onChange` | function | required | Called with the `id` when a tab is clicked or reached with the arrow keys. |

- States: `role="tablist"`, `role="tab"`, `aria-selected`; the selected tab has the 2 px accent underline and is the only tab in the tab order. Arrow keys move and select (Left and Right swap in RTL), Home and End jump to the ends. Every tab is at least 44 px high.
- Example: `<Tabs label="Threads" tabs={[{ id: 'drafts', label: 'Drafts', count: 3 }, { id: 'published', label: 'Published', count: 0 }]} value={tab} onChange={setTab} />`

## EmptyState
- File: `src/ui/EmptyState.jsx`
- Status: built
- Props:

| Prop | Type | Default | Notes |
|---|---|---|---|
| `title` | string | required | Shown as an `h2`, centred. |
| `description` | string | | One soft line under the title. |
| `action` | node | | One button, under the text. |

- States: none of its own. 48 px of room around the text.
- Example: `<EmptyState title="No drafts yet." description="Create your first thread to get started." action={<Button variant="primary">Create your first draft</Button>} />`

## ThemePicker
- File: `src/ui/ThemePicker.jsx` (flag on: `src/ui/rare/ThemeSelector.jsx`, from Rare UI)
- Status: built
- Props:

| Prop | Type | Default | Notes |
|---|---|---|---|
| `legend` | string | required | Shown above the choices; names the group. |
| `value` | string | required | The chosen theme. |
| `options` | `[{ value, label }]` | required | `value` is `light`, `dark` or `system`. |
| `onChange` | function | required | Called with the new value. |

- States: flag off (default): a `SegmentedControl` in a column. Flag on (`xt-kit` = `rare`, Feature flags > Components): Rare UI's theme selector, a 4:3 preview per theme drawn from the colour tokens in that scheme (`data-color-scope`), Match device split light and dark; radios with arrow keys (mirrored in right-to-left), Home and End; a 2 px accent ring on the chosen one. Loads in its own chunk; the segmented control shows until then.
- Example: `<ThemePicker legend="Theme" value={value} options={[{ value: 'light', label: 'Light' }]} onChange={setValue} />`

## DeleteButton
- File: `src/ui/DeleteButton.jsx` (flag on: `src/ui/rare/DeleteButton.jsx`, from Rare UI)
- Status: built
- Props:

| Prop | Type | Default | Notes |
|---|---|---|---|
| `label` | string | required | The button's name ("Delete draft"). |
| `confirm` | `{ title, body, confirmLabel }` | required | The question: the dialog's title, sentence and yes button (flag off), or the panel's name, description and yes button (flag on). |
| `onConfirm` | function | required | Runs only after a yes. May return a promise; `false` or a rejection means it failed (flag on: the button goes back to idle; the caller shows the error). |

- States: flag off (default): a `danger-quiet` small Button that opens the confirm dialog (Cancel focused). Flag on: Rare UI's delete button: a 44 px bin; a press widens it into a panel with Cancel (focused) and the yes button, both 44 px; Escape or Cancel keeps; after yes the bin is busy (`aria-busy`) until `onConfirm` settles; the check mark and "Deleted" show only on success, a failure goes back to idle; the lid and walls animate with motion, instant under reduced motion; mirrored in right-to-left. Loads in its own chunk; the Button shows until then.
- Example: `<DeleteButton label="Delete draft" confirm={{ title: 'Delete this draft?', body: 'Are you sure you want to delete this draft?', confirmLabel: 'Delete draft' }} onConfirm={remove} />`

## Count
- File: `src/ui/Count.jsx` (flag on: `src/ui/rare/AnimatedCounter.jsx`, from Rare UI)
- Status: built
- Props:

| Prop | Type | Default | Notes |
|---|---|---|---|
| `value` | number | required | The count shown first (the post's characters). |
| `max` | number | none | The limit after a slash ("/280"); shown as text, not animated. |

- States: flag off (default): plain text, `120/280`. Flag on (`xt-kit` = `rare`, Feature flags > Components): the value's digits roll to the new value (a spring, 0.6 s); the number is read once through a sr-only span; the rolling digits are aria-hidden; not a live region; the value sits in a left-to-right box so Hebrew text keeps `120/280` in order. Under the over-limit colour of `.char-counter`, the counter inherits it. Reduced motion: the digits change at once. Loads in its own chunk; the plain text shows until then.
- Tokens: `--counter-line` (one digit's height) and `--mask-counter-fade` (the top and bottom fade, alpha only) in `src/styles/tokens.css`.
- Example: `<Count value={count} max={280} />`

## Table
- File: `src/ui/Table.jsx`
- Status: built
- Props:

| Prop | Type | Default | Notes |
|---|---|---|---|
| `caption` | string | required | Names the table; shown as soft text above it. |
| `columns` | `{ key, label }[]` | required | The first column names each row. |
| `rows` | object[] | required | One object per row, with the column keys. |

- States: a real table from 768 px; below that each row is a card with a label and value line per cell.
- Example: `<Table caption="Signups" columns={[{ key: 'day', label: 'Day' }, { key: 'n', label: 'Signups' }]} rows={rows} />`

## SideLayout
- File: `src/ui/SideLayout.jsx`
- Status: built
- Props:

| Prop | Type | Default | Notes |
|---|---|---|---|
| `side` | node | required | The menu. Sits at the inline start from 768 px, above the content below that. |
| `children` | node | | The page content. |

- States: stacked under 768 px; a 14 rem side column from 768 px (`--flex-min`).
- A `nav` of Buttons as `side` is a menu (#551): rows start-aligned, two columns under 768 px, one column at the side from 768 px.
  Mark the open page with `ariaCurrent="page"` on its Button.
- Example: `<SideLayout side={<nav>…</nav>}><Section title="Statistics" /></SideLayout>`
