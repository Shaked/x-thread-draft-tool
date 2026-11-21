# UI components

The living list of the shared components in `src/ui/` (plan `docs/plans/ui-design-system.md`, section 3).
Pages only compose these and pass props. They take no `className`, and pages have no CSS of their own.
`tests/unit/ui-components.test.js` checks this file against `src/ui/`: every `## <Name>` below is a file in `src/ui/`, every
file has a section, a `Status:` line (`built`, or `not built:` with a reason), a props table and an example.

## Icon
- File: `src/ui/Icon.jsx`
- Status: built
- Props:

| Prop | Type | Default | Notes |
|---|---|---|---|
| `name` | `share` \| `agent` \| `x` \| `export` \| `signout` \| `menu` \| `close` \| `chevron` | required | Line icon from one set. |
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
| `onClick` | function | | |

- States: default, hover (only where hover exists), pressed (scale 0.98), focus-visible (the base focus ring), disabled (half opacity), loading, disabled with reason.
- Example: `<Button variant="primary" onClick={save}>Save</Button>`

## IconButton
- File: `src/ui/IconButton.jsx`
- Status: built (no page uses it yet: the first user is in the admin and editor tasks)
- Props:

| Prop | Type | Default | Notes |
|---|---|---|---|
| `icon` | icon name | required | |
| `label` | string | required | `aria-label` and the tooltip. |
| `variant` | `ghost` \| `secondary` | `ghost` | |
| `pressed` | boolean | | A toggle: sets `aria-pressed` and shows the pressed colour. |
| `disabled` | boolean | `false` | |
| `disabledReason` | string | | As in Button. |
| `onClick` | function | | |

- States: always 44 x 44. Hover, pressed, focus-visible, disabled, pressed.
- Example: `<IconButton icon="menu" label="Menu" onClick={open} />`

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
| `role` | `status` \| `alert` | `status` | Use `alert` for errors. |

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

- States: label above the control; from 600 px a Field takes its share of a row, under 600 px it takes the full width.
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
| `meta` | node[] | `[]` | Soft 14 px text items with 12 px gaps (no separators). |
| `badge` | node | | A `Badge`, shown beside the title. |
| `actions` | node | | Buttons at the end of the row; under them on phones. |
| `children` | node | | More content under the meta (for example a `CodeBlock`). |

- States: none of its own. The rows are plain list items; a link row is not built yet.
- Example: `<List><ListItem title={token.name} meta={['Created Nov 1']} badge={<Badge>Active</Badge>} /></List>`

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
