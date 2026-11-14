# T3b. One slim bar on every signed-in page, a clear Export, and a hide control

Written 2026-11-14 13:40 UTC for `docs/plans/private-drafts-share-links.md` (epic #111). Investigated on a clean export of `origin/main` at `94f1067` (T1 and T2 merged), run from `/tmp/t3b-src` with `node scripts/dev-api.mjs --fake-github` and `npx vite`, Chromium headless (Playwright 1.63, build 1243). Nothing was written in the repo.

Every fact is marked **[checked]** (measured or read today) or **[not checked]**.

Scratch files (all under `/tmp/claude-0/-home-user-x-thread-draft-tool/5ebed72c-31a3-5571-9bea-2c2583c63ed9/scratchpad/`):
- `t3b/before-<width>-<name>.png`: the app today at 390, 360 and 1280 px.
- `t3b/after-mock-<width>-<theme>-<name>.png`: the new bar, mocked in the live page (the CSS below injected, the old bar and toggle removed) at 390 light, 390 dark, 360, 320 and 1280 px.
- `bar.css`: the exact CSS used for the mock. `shoot.cjs`, `mock.cjs`: the two measuring scripts.

## 1. What is wrong today (measured)

| # | Fact | Number | State |
|---|---|---|---|
| 1 | Phone bar on the editor, 390x844. It wraps to two rows: Share, Agent link, X Thread, Publish, then a full-width Logout. | 111 px high = 13.2 % of the screen (360x740: 111 px = 15 %) | [checked] `before-390-editor.png` |
| 2 | The round toggle sits on top of the bar's edge. | 48x48 px at y 700 to 748; the bar starts at y 733, so they overlap by 15 px. Bar plus toggle take the bottom 144 px (17 %). | [checked] |
| 3 | The owner's screenshot (production, before T2) shows a one-row bar of about 96 px plus the iPhone inset. T2 added Share, so it is now two rows. | 96 px is the value in the CSS (`padding-bottom: calc(96px + ...)`) | [checked] in CSS, [not checked] on the owner's phone |
| 4 | The bar exists only in the editor. The draft list and the settings page have no bar and no sign-out button. | `.header-actions` and `.logout-btn` not in the DOM on `/` and `/settings/tokens` | [checked] |
| 5 | **Why the toggle "does nothing".** On screens under 1024 px the export panel starts collapsed. A tap un-collapses it, but on phones the panel is placed at the **top of the page** (`order: -1`). In the middle of a draft it appears 1643 px above the screen. The browser keeps the visible text in place (scroll position moved from 1500 to 1739 as the page grew by 219 px), so nothing on screen changes except the arrow, which flips from ◀ to ▶. | panel at y = -1643, `panelInViewport: false` | [checked] `before-390-editor-toggled-midscroll.png`; the panel is only seen after scrolling to the top (`before-390-editor-toggled-top.png`) |
| 6 | The panel holds four buttons: JSON, Markdown, Copy, Copy (Numbered) (`src/components/ExportOptions.jsx`). On a phone these are the only way to copy the whole thread. | 4 buttons, 199 px high | [checked] |
| 7 | **New bug from T2, on `main` now: the Share menu cannot be used on a phone.** The menu opens below its button (`top: 100%`), and the button is in the bottom bar, so the menu is off the screen. | menu at x = -96, y = 794 to 1031 on an 844 px screen; only a corner shows | [checked] `before-390-editor-share-menu.png` |
| 8 | Last post is not covered today when scrolled to the end. | hint box ends at y 693, bar starts at y 733 | [checked] |
| 9 | Desktop (1280): actions are in the header, 44 px high, one row. The export panel is a 350 px column on the right and the toggle works there. | header 69 px | [checked] `before-1280-editor.png` |
| 10 | The app UI is English, left to right: `<html lang="en">`, no `dir`. Hebrew is only inside posts and titles (`dir` on the text areas). | | [checked] `index.html`, `App.css` lines 281 to 287 |
| 11 | The required E2E job (`npm run test:e2e`, project `chromium`) starts no server today; its tests render HTML strings. The screenshot job (`screens`) is manual. | | [checked] `.github/workflows/tests.yml`, `playwright.config.ts` |

## 2. Design

### 2.1 Decisions

1. **The round toggle and the side panel are removed, on every screen width.** Export becomes one button, "Export", next to Share. It opens a menu with the same four actions: Copy thread, Copy with numbers, Download Markdown, Download JSON. One UI for phones and desktop. On desktop the editor column becomes 900 px wide and centred (the draft list is already 900 px). Cost on desktop: Export is one click further away than today.
2. **Phone (768 px and narrower): one fixed bottom bar, 44 px high plus the safe-area inset, one row, never wraps.** Icons only, each with `aria-label` and `title`. Publish (and "New draft" on the list) keeps its text, as a 32 px pill: it is the primary action.
3. **Wide screens (769 px and wider): no fixed bar.** The same component is rendered inside the page header, as today in the editor. Sign-out is a 44 px icon button at the end of the header. Nothing covers content, so there is no hide control there. The stored hide choice has no effect on wide screens.
4. **Hide.** The last slot of the bar is a chevron button. A tap slides the actions out. A 44x24 px tab with an up chevron stays in the same corner. A tap on the tab brings the bar back. It is the same button element in both states, so keyboard focus never moves.
5. **Sign-out** is icon only, grey (`--text-soft`), 40 px wide, after Publish with an 8 px gap. It is never hidden in a menu. When the bar is hidden, sign-out is two taps away (tab, then sign-out); the tab is always visible.
6. **One shared component rendered by each page**, not once in `App.jsx`. Reason: on wide screens the bar must sit inside each page's own header, and the editor's actions need the editor's state. A component in `App.jsx` would need a portal or a context to receive them. Per page it is one JSX line, and the login page and `/x-thread-preview/:token` have no bar because they never render it.
7. **Split into two pull requests.** T3b-1 (Export menu, toggle removed, Share menu fixed on phones) is small, removes code, and fixes item 7 above, which is broken on production now. T3b-2 is the bar. Each ships alone.

### 2.2 The bar on a phone (390 px), measured on the mock

```
shown (44 px + inset; 5.2 % of 844)
├──────────────────────────────────────────────────────────┤  1 px line (box-shadow)
│ [↑]  [🤖]  [X]  [↓]            ( Publish )   [→]   [v]   │  44 px
└──────────────────────────────────────────────────────────┘
  Share Agent XThr Export          32 px pill  Sign  Hide
  40    40    40   40              79 wide     out   40
  x=4   44    84   124             x=219       306   346

hidden (only the tab; 24 px + inset; 2.8 %)
                                                   ╭─────╮
                                                   │  ^  │  44 x 24 px, x=342
───────────────────────────────────────────────────┴─────┘
```

| Page | In the bar (phone, left to right) | Wide screen |
|---|---|---|
| Editor | Share, Agent link, X Thread, Export, Publish (not when published), Sign out, Hide | Same buttons with text in the header; sign-out is an icon; no Hide |
| Draft list | New draft (moved from the page header; not shown when the list is empty, as today), Sign out, Hide | New draft and the sign-out icon in the list header |
| Settings | Sign out, Hide | Sign-out icon on the "Back to drafts" row |

No overflow menu is needed: all seven controls fit.

| Width | Bar height | Fits in one row | State |
|---|---|---|---|
| 390 | 44 px (was 111) | yes, 87 px spare | [checked] mock |
| 360 | 44 px (was 111) | yes, 57 px spare | [checked] mock |
| 320 | 44 px | yes, with Publish as an icon (rule at 359 px and narrower) | [checked] mock |
| hidden, 390 | tab 44x24 px at y 820 | | [checked] mock |
| 1280 | header unchanged, 44 px buttons | | [checked] mock |

Last post with the bar shown, scrolled to the end at 390 px: content ends at y 744, bar starts at y 800 [checked]. Hidden: content ends at y 764, tab starts at y 820 [checked].

### 2.3 Details

- **Icons**: six inline SVG paths in one small file, drawn with `currentColor`, so both themes work with no new colour token. The emoji icons on Share, Agent link and X Thread are replaced (they look different on every phone). Publish keeps its text.
- **Theme tokens used**: `--bg` (bar), `--border` (top line, tab border), `--text-strong` (icons), `--text-soft` (sign-out, chevron), `--success` and `--accent-text` (Publish), `--surface` (tab), `--focus` (focus ring). All exist in light and dark [checked]. `--text-soft` on `--bg` is 5.9:1 in light [checked by calculation]; the dark pair is [not checked] by calculation, add it to `tests/unit/contrast.test.js`.
- **Target size (WCAG 2.2, 2.5.8 level AA, 24x24 px minimum)**: icon slots are 40x44 px, Publish 79x32 px, the tab 44x24 px. All pass AA. The tab and Publish do not reach the AAA size of 44x44 (2.5.5); that is accepted to keep the bar small.
- **RTL**: the bar uses logical properties (`inset-inline`, `margin-inline-start`). The page is LTR, so the bar is LTR. Hebrew post text is not affected. If the page ever gets `dir="rtl"`, the bar mirrors with no change.
- **Safe area**: `height: calc(44px + env(safe-area-inset-bottom))`, with the inset as bottom padding. The hidden tab adds the inset to its height. [not checked] on a real iPhone; headless Chromium reports an inset of 0.
- **Content padding**: `--bar-space` is the height the bar takes (44 px + inset shown, 24 px + inset hidden, 0 on wide screens and on pages with no bar). `.app` gets `padding-bottom: calc(var(--bar-space) + 16px)`. `html` gets `scroll-padding-bottom: var(--bar-space)`, so a focused text area is scrolled clear of the bar.
- **Keyboard open on a phone**: the bar is `position: fixed; bottom: 0`. On iOS Safari and on Chrome for Android 108 and newer the on-screen keyboard does not resize the page, so the bar stays under the keyboard and never jumps over the text area. To make this explicit for every browser that supports it, add `interactive-widget=resizes-visual` to the viewport meta tag. No JavaScript. [not checked] on real devices: headless Chromium has no on-screen keyboard.
- **Menus from the bar** (Share, Export) and the "Link copied" messages open as a sheet above the bar: `position: fixed; left: 8px; right: 8px; bottom: calc(var(--bar-space) + 8px)`.
- **Hide, storage**: key `xt-bar`, values `hidden` or `shown`, in `localStorage` inside try/catch, with a module variable as the fallback for this page load (same pattern as `src/utils/theme.js`). Per browser. Not sent to the server.
- **Hide, animation**: the actions move down and fade in 0.2 s (`transform`, `opacity`, `visibility`). With `prefers-reduced-motion: reduce` there is no transition.
- **Hide, accessibility**: the toggle is a `<button>` with `aria-expanded` (true when the bar is shown), `aria-controls="app-bar-actions"`, and the label "Hide toolbar" or "Show toolbar" (also the `title`). Hidden actions get `visibility: hidden`, so they leave the tab order and the accessibility tree. Enter and Space work because it is a button. Focus stays on the toggle after each press.

## 3. Tasks

Order: **T3b-1, then T3b-2, then T3, then T3a.** Reasons are in section 4. Pull request bodies start with `Implements docs/plans/private-drafts-share-links.md Task 3 (T3b-1)` and `... Task 3 (T3b-2)`; the `Net lines` check needs the words `Task 3` on that line [checked: `scripts/net-lines.mjs` pattern `docs/plans/<file>.md.*Task \d+`].

### T3b-1. Export is a button with a menu; the round toggle is gone; the Share menu works on phones

Files: `src/components/ExportOptions.jsx`, new `src/utils/useDismiss.js`, `src/components/ShareLinkButton.jsx`, `src/pages/DraftEditor.jsx`, `src/styles/App.css`, new `tests/unit/ExportOptions.test.jsx`, `tests/unit/ShareLinkButton.test.jsx` (must still pass unchanged), `tests/e2e/screens.spec.ts`, `docs/features/sharing-and-export.md`, changelog.

1. New `src/utils/useDismiss.js` (moves the effect out of `ShareLinkButton.jsx`, so the two menus do not duplicate it; the `dup` check counts 50 tokens):
   ```js
   import { useEffect } from 'react'

   /** While `open` is true, calls setOpen(false) on Escape and on a press outside ref.current. */
   export function useDismiss(open, ref, setOpen) {
     useEffect(() => {
       if (!open) return undefined
       const onKey = (event) => {
         if (event.key === 'Escape') setOpen(false)
       }
       const onPointer = (event) => {
         if (ref.current && !ref.current.contains(event.target)) setOpen(false)
       }
       document.addEventListener('keydown', onKey)
       document.addEventListener('pointerdown', onPointer)
       return () => {
         document.removeEventListener('keydown', onKey)
         document.removeEventListener('pointerdown', onPointer)
       }
     }, [open, ref, setOpen])
   }
   ```
2. `ShareLinkButton.jsx`: delete its `useEffect` block (the one with `onKey` and `onPointer`) and write `useDismiss(open, container, setOpen)` in its place. Remove `useEffect` from the React import.
3. `ExportOptions.jsx`: keep `exportAsJSON`, `exportAsMarkdown` and `copyToClipboard` as they are. Delete the "No content to export" block. Replace the returned JSX with a button and a menu, built like the Share button:
   ```jsx
   const [open, setOpen] = useState(false)
   const container = useRef(null)
   useDismiss(open, container, setOpen)
   const ACTIONS = [
     ['Copy thread', () => copyToClipboard(false)],
     ['Copy with numbers', () => copyToClipboard(true)],
     ['Download Markdown', exportAsMarkdown],
     ['Download JSON', exportAsJSON]
   ]

   return (
     <div className="share-button-container" ref={container}>
       <button
         className="share-btn icon-btn"
         onClick={() => setOpen(!open)}
         disabled={posts.length === 0}
         aria-haspopup="dialog"
         aria-controls="export-menu"
         aria-expanded={open}
         title="Copy or download the whole thread"
         aria-label="Export"
       >
         <span className="btn-icon">⬇</span>
         <span className="btn-text">Export</span>
       </button>
       {open && (
         <div className="share-menu" id="export-menu" role="group" aria-label="Export">
           {ACTIONS.map(([label, run]) => (
             <button key={label} className="share-menu-item" onClick={() => { setOpen(false); run() }}>
               {label}
             </button>
           ))}
         </div>
       )}
     </div>
   )
   ```
   Put the hooks before any other statement that returns. Import `useRef`, `useState` and `useDismiss`.
4. `DraftEditor.jsx`:
   - Add `<ExportOptions draft={draft} />` inside `.header-actions`, right after `<XThreadLinkButton draftId={id} />`.
   - Delete: the `sidebarCollapsed` state, the "Collapse sidebar by default" `useEffect`, the `<SidePanel ... />` element, the whole `SidePanel` function and its comment.
   - Change `<div className={`editor-content ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>` to `<div className="editor-content">`.
5. `App.css`, delete these rules everywhere they appear (base and inside the 768 px media block): `.side-panel`, `.side-panel.collapsed`, `.sidebar-toggle`, `.sidebar-toggle:hover`, `.editor-content.sidebar-collapsed`, `.editor-content.sidebar-collapsed .sidebar-toggle`, `.export-options`, `.export-options h2`, `.export-actions` (three places: base, the 768 px block near line 380 where it shares a selector with `.draft-actions`: keep `.draft-actions`, and the grid rule near line 1647), `.export-actions .btn`, `.export-actions .btn:focus-visible` (keep `.share-btn:focus-visible`).
6. `App.css`, change `.editor-content` to one column: replace `grid-template-columns: 1fr 350px;` with `grid-template-columns: 1fr;`, replace `max-width: 1400px;` with `max-width: 900px;`, delete its `transition` line. In the 768 px block delete the `.editor-content { ... }` rule (it only repeats one column).
7. `App.css`, in the 768 px block, right after the `.header-actions .share-tooltip { ... }` rule, add (this fixes the Share menu that opens off the screen):
   ```css
   .header-actions .share-menu {
     position: fixed;
     top: auto;
     right: 16px;
     left: 16px;
     bottom: 140px;
     margin: 0;
   }
   ```
8. New `tests/unit/ExportOptions.test.jsx` (jsdom; copy the clipboard mock from `ShareLinkButton.test.jsx`): the menu is closed at first; a click on "Export" shows the four items; "Copy with numbers" writes `exportAsNumberedText(posts)` to the clipboard and closes the menu (stub `window.alert`); Escape closes the menu; with `posts: []` the button is disabled.
9. `tests/e2e/screens.spec.ts`: after the `editor` shot add a shot `editor-export-menu` (open the editor, click the button named "Export", wait for the text "Copy with numbers"). `shoot` needs one new option, `before?: (page: Page) => Promise<void>`, run after `ready` and before the screenshot. Add the name to the header comment.
10. `docs/features/sharing-and-export.md`: Export is a button next to Share, on phones and desktop.
11. Changelog `docs/changelogs/<UTC stamp>-export-menu.md`.

Done when:
- `npm run lint`, `npm run build`, `npm run test:unit`, `npm run dup`, `npm run knip` pass.
- `grep -c "sidebar-toggle\|side-panel\|sidebarCollapsed\|export-actions" src -r` prints 0 for every file.
- The `screens` job (run by workflow dispatch on the branch) shows at 390 px: no round button in `editor.png`; in `editor-export-menu.png` the four items are fully inside the screen. The pull request links the two images.
- A Playwright check in the pull request description (run by the executor against the local servers, numbers pasted): at 390x844, after a click on "Share", the `.share-menu` box has `top >= 0`, `left >= 0`, `bottom <= 844`. Same for "Export". (T3b-2 turns this into a permanent test.)
- `Net lines`: product code shrinks. Expected about +60 and -190 lines under `src/` (net about -130). [not checked]: an estimate from reading the files.

### T3b-2. One slim bar on every signed-in page, with a hide control

Files: new `src/components/AppBar.jsx`, new `src/components/Icon.jsx`, new `src/components/LogoutButton.jsx`, new `src/utils/barPref.js`, `src/pages/DraftEditor.jsx`, `src/components/DraftList.jsx`, `src/pages/TokensPage.jsx`, `src/components/ShareLinkButton.jsx`, `src/components/AgentLinkButton.jsx`, `src/components/XThreadLinkButton.jsx`, `src/components/ExportOptions.jsx`, `src/styles/App.css`, `index.html`, new `tests/unit/barPref.test.js`, new `tests/unit/AppBar.test.jsx`, `tests/unit/contrast.test.js`, new `tests/e2e/app-bar.spec.ts`, `playwright.config.ts`, `tests/e2e/screens.spec.ts`, `docs/screenshots/T3b/`, `docs/features/`, changelog. This task touches more than three code files at once in steps 5 to 7: use the Sonnet helper for those steps if Haiku fails once.

1. New `src/utils/barPref.js`:
   ```js
   // Whether the phone bottom bar is hidden. Stored in this browser only, under 'xt-bar'.
   export const BAR_KEY = 'xt-bar'

   // The last choice made in this page. Used when storage is blocked.
   let sessionHidden = false

   /** True when the saved choice is 'hidden'. */
   export function isBarHidden() {
     try {
       const stored = localStorage.getItem(BAR_KEY)
       if (stored === 'hidden' || stored === 'shown') return stored === 'hidden'
     } catch {
       // Storage can be blocked (private mode). The choice still holds for this page.
     }
     return sessionHidden
   }

   /** Saves the choice. Returns the value now in effect. */
   export function setBarHidden(hidden) {
     sessionHidden = Boolean(hidden)
     try {
       localStorage.setItem(BAR_KEY, sessionHidden ? 'hidden' : 'shown')
     } catch {
       // See above.
     }
     return sessionHidden
   }
   ```
2. New `src/components/Icon.jsx` (paths are final; they were rendered in the mock, see `after-mock-390-light-editor.png`):
   ```jsx
   // Line icons, drawn with the current text colour.
   const PATHS = {
     share: 'M12 3v12M8 7l4-4 4 4M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7',
     agent: 'M12 4v3M6 7h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2zM9 12v2M15 12v2',
     x: 'M5 4l14 16M19 4L5 20',
     export: 'M12 4v11M8 11l4 4 4-4M5 20h14',
     signout: 'M10 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4M15 8l4 4-4 4M19 12H9',
     chevron: 'M6 9l6 6 6-6'
   }

   export default function Icon({ name }) {
     return (
       <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
         <path d={PATHS[name]} />
       </svg>
     )
   }
   ```
3. New `src/components/LogoutButton.jsx` (the editor's `handleLogout`, moved; T3a later adds the cache clearing here):
   ```jsx
   import { authApi } from '../utils/api'
   import Icon from './Icon'

   /** Signs out of this browser, then reloads so the app reads the cleared session. */
   export default function LogoutButton() {
     const signOut = async () => {
       try {
         await authApi.logout()
       } catch (err) {
         console.error('Logout error:', err)
       }
       window.location.assign('/')
     }
     return (
       <button type="button" className="logout-btn icon-btn" onClick={signOut} title="Sign out" aria-label="Sign out">
         <Icon name="signout" />
       </button>
     )
   }
   ```
4. New `src/components/AppBar.jsx`:
   ```jsx
   import { useEffect, useState } from 'react'
   import { isBarHidden, setBarHidden } from '../utils/barPref'
   import Icon from './Icon'
   import LogoutButton from './LogoutButton'

   /** The actions of a signed-in page plus sign-out. In the page header on wide screens; a fixed bottom bar that can be hidden on phones. */
   export default function AppBar({ children }) {
     const [hidden, setHidden] = useState(isBarHidden)

     // The page padding follows this attribute (see --bar-space in App.css).
     useEffect(() => {
       document.documentElement.dataset.bar = hidden ? 'hidden' : 'shown'
       return () => {
         delete document.documentElement.dataset.bar
       }
     }, [hidden])

     const label = hidden ? 'Show toolbar' : 'Hide toolbar'
     return (
       <div className={`app-bar${hidden ? ' is-hidden' : ''}`}>
         <div className="app-bar-actions" id="app-bar-actions">
           {children}
           <LogoutButton />
         </div>
         <button
           type="button"
           className="app-bar-toggle"
           onClick={() => setHidden(setBarHidden(!hidden))}
           aria-expanded={!hidden}
           aria-controls="app-bar-actions"
           aria-label={label}
           title={label}
         >
           <Icon name="chevron" />
         </button>
       </div>
     )
   }
   ```
5. `DraftEditor.jsx`: replace `<div className="header-actions">` and its closing `</div>` with `<AppBar>` and `</AppBar>`. Delete the `{user && (<button className="logout-btn ...`  block and the `handleLogout` function. Import `AppBar`. `authApi` is still used by `LoadError`; keep that import. The editor's complexity goes down (one condition and one handler removed); `npm run lint` must stay under 20.
6. `DraftList.jsx`: in `.draft-list-header`, wrap the existing conditional "New draft" button in the bar. The result:
   ```jsx
   <AppBar>
     {!(activeTab === 'drafts' && !loading && !error && drafts.length === 0) && (
       <button className="new-draft-btn" onClick={createNewDraft}>
         New draft
       </button>
     )}
   </AppBar>
   ```
   Keep the "API tokens" button after it. `tests/e2e/image-upload.spec.ts` clicks `.new-draft-btn` first; it still matches [checked by reading].
7. `TokensPage.jsx`: change `<p><Link to="/">← Back to drafts</Link></p>` to
   ```jsx
   <div className="settings-top">
     <Link to="/">← Back to drafts</Link>
     <AppBar />
   </div>
   ```
8. Icons in the four buttons: in `ShareLinkButton.jsx` replace `'🔗'` with `<Icon name="share" />`; in `AgentLinkButton.jsx` replace `'🤖'` with `<Icon name="agent" />`; in `XThreadLinkButton.jsx` replace the 𝕏 character with `<Icon name="x" />`; in `ExportOptions.jsx` replace `⬇` with `<Icon name="export" />`. The `'✓'` shown after a copy stays. Import `Icon` in each.
9. `index.html`: in the viewport meta tag, add `, interactive-widget=resizes-visual` at the end of `content`.
10. `App.css`, delete:
    - In the 768 px block: the comment "Phone: the editor actions move to a sticky bottom bar" and the rules `.header-actions`, `.header-actions > *`, `.header-actions .icon-btn`, `.header-actions .icon-btn .btn-icon`, `.header-actions .share-tooltip`, `.header-actions .share-menu` (from T3b-1), `.draft-editor { padding-bottom: calc(96px + ...) }`, and `.new-draft-btn { width: 100%; }`.
    - The base rule `.header-actions { ... }`.
    - The two rules `.logout-btn { min-height: 44px; }` and `.logout-btn:hover { ... }` are replaced in step 11; delete them here.
    - In the 600 px block, the `.share-tooltip { ... bottom: 140px ... }` rule.
11. `App.css`, add at the place where `.header-actions` was. This is the content of the scratch file `bar.css`, used unchanged in the mock, with one selector change (`.app-bar svg` becomes `.icon`) and one added line (`.settings-top`):
    ```css
    /* App bar: page actions, sign-out and the hide control. In the page header on wide screens, a fixed bottom bar on phones. */
    :root { --bar-h: 44px; --bar-space: 0px; }
    .app-bar, .app-bar-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
    .app-bar-toggle { display: none; }
    .icon { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .logout-btn { min-width: 44px; min-height: 44px; padding: 0; justify-content: center; color: var(--text-soft); }
    .logout-btn:hover { background-color: var(--surface-2); border-color: var(--danger); }
    .settings-top { display: flex; align-items: center; justify-content: space-between; }

    @media (max-width: 768px) {
      :root[data-bar='shown'] { --bar-space: calc(var(--bar-h) + env(safe-area-inset-bottom, 0px)); }
      :root[data-bar='hidden'] { --bar-space: calc(24px + env(safe-area-inset-bottom, 0px)); }
      html { scroll-padding-bottom: var(--bar-space); }
      .app { padding-bottom: calc(var(--bar-space) + 16px); }

      .app-bar {
        position: fixed; inset-inline: 0; bottom: 0; z-index: 100;
        height: calc(var(--bar-h) + env(safe-area-inset-bottom, 0px));
        padding: 0 4px env(safe-area-inset-bottom, 0px);
        gap: 0; align-items: flex-end;
        background-color: var(--bg); box-shadow: 0 -1px 0 var(--border);
        transition: background-color 0.2s, box-shadow 0.2s;
      }
      .app-bar-actions { flex: 1; min-width: 0; height: var(--bar-h); gap: 0; transition: transform 0.2s, opacity 0.2s, visibility 0.2s; }
      .app-bar .icon-btn, .app-bar-toggle {
        display: inline-flex; align-items: center; justify-content: center;
        width: 40px; min-width: 40px; height: var(--bar-h); min-height: 0; padding: 0;
        background: none; border: 0; border-radius: 8px; color: var(--text-strong); cursor: pointer;
      }
      .app-bar .btn-text { display: none; }
      .app-bar .publish-btn, .app-bar .new-draft-btn {
        width: auto; height: 32px; min-height: 0; align-self: center; padding: 0 14px; margin-inline-start: auto;
        border-radius: 16px; font-size: 14px;
      }
      .app-bar .publish-btn { background-color: var(--success); color: var(--accent-text); }
      .app-bar .publish-btn .btn-text { display: inline; }
      .app-bar .publish-btn .btn-icon { display: none; }
      .app-bar .logout-btn, .app-bar-toggle { color: var(--text-soft); }
      .app-bar .logout-btn { margin-inline-start: auto; }
      .app-bar .publish-btn ~ .logout-btn, .app-bar .new-draft-btn ~ .logout-btn { margin-inline-start: 8px; }
      .app-bar .icon-btn:focus-visible, .app-bar-toggle:focus-visible { outline: 2px solid var(--focus); outline-offset: -2px; }

      /* Hidden: the actions slide out and only the tab stays, in the same corner. */
      .app-bar.is-hidden { background-color: transparent; box-shadow: none; pointer-events: none; padding-bottom: 0; }
      .app-bar.is-hidden .app-bar-actions { visibility: hidden; opacity: 0; transform: translateY(100%); }
      .app-bar.is-hidden .app-bar-toggle {
        pointer-events: auto; width: 44px; height: calc(24px + env(safe-area-inset-bottom, 0px)); padding-bottom: env(safe-area-inset-bottom, 0px);
        background-color: var(--surface); border: 1px solid var(--border); border-bottom: 0; border-radius: 12px 12px 0 0;
      }
      .app-bar.is-hidden .app-bar-toggle .icon { transform: rotate(180deg); }

      /* Menus and messages of bar buttons open as a sheet above the bar. */
      .app-bar .share-menu, .app-bar .share-tooltip {
        position: fixed; top: auto; left: 8px; right: 8px; bottom: calc(var(--bar-space) + 8px);
        width: auto; max-width: none; margin: 0;
      }
      .app-bar .share-tooltip { text-align: center; }
    }

    @media (max-width: 359px) {
      .app-bar .publish-btn { width: 40px; padding: 0; }
      .app-bar .publish-btn .btn-text { display: none; }
      .app-bar .publish-btn .btn-icon { display: inline; }
    }

    @media (prefers-reduced-motion: reduce) {
      .app-bar, .app-bar-actions { transition: none; }
    }
    ```
    Format it as the rest of the file (one declaration per line) if the lint or the reviewer asks; the values must not change.
12. `tests/unit/barPref.test.js`: default is not hidden; `setBarHidden(true)` stores `hidden` under `xt-bar` and `isBarHidden()` is true; `setBarHidden(false)` stores `shown`; a junk stored value counts as not hidden; when `localStorage.setItem` and `getItem` throw (spy on `Storage.prototype`), `setBarHidden(true)` does not throw and `isBarHidden()` is true for this page.
13. `tests/unit/AppBar.test.jsx` (mock `../../src/utils/api` with `authApi.logout`): children are rendered; a button named "Sign out" exists; the toggle is named "Hide toolbar", has `aria-expanded="true"` and `aria-controls="app-bar-actions"`, and an element with that id exists; after a click it is named "Show toolbar", `aria-expanded="false"`, the root has class `is-hidden`, `localStorage['xt-bar']` is `hidden`, `document.documentElement.dataset.bar` is `hidden`, and the toggle still has focus; keyboard: focus the toggle and press Enter with `userEvent.keyboard('{Enter}')`, the state flips back; a new render with `xt-bar = hidden` stored starts hidden; after unmount `dataset.bar` is undefined; a click on "Sign out" calls `authApi.logout` once (stub `window.location` with `vi.stubGlobal` or spy `assign`).
14. `tests/unit/contrast.test.js`: add the pair `['text-soft', 'bg', 4.5]`.
15. `playwright.config.ts`: add the local servers, so the required E2E job can test the real app:
    ```ts
    webServer: process.env.XT_BASE_URL
      ? undefined
      : [
          { command: 'npm run dev:api', port: 8787, reuseExistingServer: !process.env.CI },
          {
            command: 'npm run build && npx vite preview --host 127.0.0.1 --port 4173 --strictPort',
            port: 4173,
            reuseExistingServer: !process.env.CI,
            timeout: 120_000
          }
        ],
    ```
    [not checked]: that the E2E job on GitHub passes with this block. If the job fails to start the servers, ask Opus; do not move the new test out of the required job.
16. New `tests/e2e/app-bar.spec.ts` (project `chromium`, so it runs in the required job). Sign in as `screens.spec.ts` does: `POST /api/dev/token`, then add the bearer header to every `/api/` request with `context.route`. Create one draft with 8 posts through the API (Hebrew text; the last post contains `LAST-POST`). Base URL `process.env.XT_BASE_URL ?? 'http://127.0.0.1:4173'`. Context: `viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block'`. Tests:
    1. For each of `/`, `/draft/<id>`, `/settings/tokens`: `.app-bar` is visible; its bounding box has `height <= 56` and `y + height === 844`; a button named "Sign out" is visible; `document.documentElement.scrollWidth <= 393` (no new sideways scroll; the editor is 393 today).
    2. Editor, one row: every visible button inside `.app-bar` has the same vertical centre (within 1 px), and each box has `width >= 40` and `height >= 24`.
    3. Editor: `.sidebar-toggle` count is 0. A click on "Export" shows "Copy with numbers", and the `.share-menu` box has `y >= 0`, `x >= 0`, `y + height <= 800`. Same check after a click on "Share" (text "1 hour").
    4. Editor, last post not covered: scroll to the end (`window.scrollTo(0, document.documentElement.scrollHeight)`); the bottom of the text area that contains `LAST-POST` and the bottom of `.main-panel` are both `<=` the `y` of `.app-bar`.
    5. Hide: click "Hide toolbar". The "Sign out" button is hidden (`toBeHidden`), the button "Show toolbar" is visible with a box of `height <= 36` and `width >= 24`, `aria-expanded` is `false`. Scroll to the end: the bottom of `.main-panel` is `<=` the `y` of the tab. Reload: still hidden (`Show toolbar` visible). Open `/` and `/settings/tokens`: still hidden there. Click "Show toolbar": "Sign out" is visible again; reload: still shown.
    6. Width 360x740 and 320x568: on the editor `.app-bar` height is `<= 56` and test 2 holds.
    7. Width 1280x800 on the editor: `.app-bar-toggle` is hidden; "Sign out" is visible and its box is inside the header (`y < 100`); `getComputedStyle(.app-bar).position` is `static`.
    8. `/x-thread-preview/<token>` (make a share token through the API) and `/` signed out: `.app-bar` count is 0.
    9. Reduced motion: a context with `reducedMotion: 'reduce'`; `getComputedStyle(.app-bar-actions).transitionDuration` is `0s`.
17. `tests/e2e/screens.spec.ts`: add the shot `editor-bar-hidden` (click "Hide toolbar" in the `before` option from T3b-1) and take every shot of the viewport as well as the full page when the width is under 800 (`<name>-viewport.png`, `fullPage: false`): a full-page shot does not show where a fixed bar sits on the screen. Update the header comment with the new names.
18. `docs/screenshots/T3b/`: copy the 390 px `editor-viewport`, `drafts-three-viewport`, `tokens-viewport` and `editor-bar-hidden-viewport` images from the `screens` job as `after-*.png`, and the same pages from a `screens` run on `main` as `before-*.png` (the folder `docs/screenshots/6.3d` shows the naming).
19. `docs/features/`: one short section: the bar, what is on it per page, how to hide it, that the choice is kept in this browser only.
20. Changelog `docs/changelogs/<UTC stamp>-app-bar.md`.

Done when (all without a person):
- `npm run lint` (editor complexity under 20), `npm run build`, `npm run test:unit`, `npm run dup`, `npm run knip`, `npm run test:budget` pass.
- `tests/e2e/app-bar.spec.ts` passes in the required E2E job: bar height at most 56 px on the three pages at 390 px (expected 44; today 111 on the editor and none on the other two), one row at 390, 360 and 320 px, no `.sidebar-toggle`, menus on screen, last post not covered in both states, hide survives a reload and holds on all three pages, no bar on the login and preview pages.
- `grep -c "header-actions" src -r` prints 0 for every file except the `post-header-actions` matches in `PostBox.jsx` and `App.css`.
- The `screens` job artifacts are linked in the pull request, and the before and after images are in `docs/screenshots/T3b/`.
- Opus has looked at the four after images (390 light, 390 dark, hidden, 1280) and answered `APPROVE`.
- After merge: production deployment READY and the deployed smoke test green (P-PROD).
- `Net lines`: expected about +190 and -95 lines under `src/` for this pull request (net about +95: four new small files and the CSS). Both parts together: about +250 and -285, net about -35. The pull request body names `Task 3`, so the check passes. [not checked]: estimates.

## 4. Order, and the new text for T3a

- **T3b-1 first**: it fixes the Share menu on phones (broken on production since T2) and removes the button the owner reported.
- **T3b-2 before T3a**: T3a as written adds a sign-out button to the list and the settings page by hand. T3b-2 puts sign-out on those pages through the bar. If T3a went first, T3b-2 would remove what T3a added.
- **T3** (copy link on the consent page) touches only server files; it can go before or after T3b with no conflict.
- **T3a** keeps the server work and the consent page. Its UI part shrinks to one edit in `LogoutButton.jsx`.

Replacement text for the plan file (do not apply by hand here; the coordinator edits the plan in the T3b-1 pull request):

1. Section 4, add a row:
   `| D11 | Signed-in pages share one bar: page actions, a small sign-out button and a hide control. On phones it is a fixed bottom bar at most 44 px high plus the safe area; on wide screens it sits in the page header. The hide choice is kept in the browser only (`xt-bar`). Export is a button with a menu; the round export toggle is removed. | Shaked, 2026-11-14 (bar on every page, smaller, hideable, phones included); agent (layout, Export as a menu on desktop too) |`
2. Section 5, first line: `Do them in this order: T0, T1, T2, T3b-1, T3b-2, T3, T3a, T4 to T7.`
3. Insert the two task sections above (T3b-1, T3b-2) before `### T3. Copy link ...`.
4. T3a, the "State today" paragraph, first sentence becomes: `State today (after T3b-2): every signed-in page has a sign-out button in the shared bar (`src/components/AppBar.jsx` renders `src/components/LogoutButton.jsx`).`
5. T3a, the `Files:` line: remove `new src/components/LogoutButton.jsx`, `src/components/DraftList.jsx`, `src/pages/TokensPage.jsx`, `src/pages/DraftEditor.jsx`; add `src/components/LogoutButton.jsx` (it exists) and `tests/e2e/app-bar.spec.ts`.
6. T3a step 3 becomes:
   `3. `LogoutButton.jsx` (exists since T3b-2, shown by `AppBar` on the list, the editor and the settings page): after `authApi.logout()` and before loading `/`, delete every `draft-*` key from IndexedDB (`keys()` and `delMany()` from `idb-keyval`). Do not add the button to any page.`
7. T3a step 6, the Playwright sentence becomes: `a Playwright test in `tests/e2e/app-bar.spec.ts` opens the list, the editor and the settings page at 390 px, clicks "Sign out" in the bar on each and lands on the login page; with the bar hidden it first clicks "Show toolbar".` The cookie sentence that follows stays.
8. Section 6, add: `- On a 390 px phone the bar is at most 56 px high on the list, the editor and the settings page, can be hidden, and the choice survives a reload (Playwright, required job).`

Epic #111: add rows `T3b-1 export menu` and `T3b-2 app bar`, and record the owner's four points of 2026-11-14 in the decision log as D11.

## 5. Risks

1. **Desktop loses the always-open export panel** (decision 1). It is a design choice the owner did not ask for. If he wants the panel back on desktop, the cost is the old CSS for 769 px and wider; the phone design does not change. Say this in the T3b-1 pull request.
2. **Sign-out sits between Publish and Hide.** A wrong tap signs the user out; after T3a that also clears cached drafts. Unsaved text is at most 1 second old (autosave), and an 8 px gap plus the grey colour separate it. If Opus judges it too close, move sign-out to the start of the bar (`order: -1` on phones only).
3. **Hiding the bar hides Publish and New draft on a phone.** That is what the owner asked for; the tab brings them back in one tap. The empty list keeps its own "Create your first draft" button.
4. **Icons without text** on a phone: Agent link and X Thread are less obvious than words. `title` does not show on touch. The "copied" message still explains what happened after a tap. If the owner finds them unclear, the fallback is a "more" menu with text rows; the bar has 57 px spare at 360 px.
5. **First paint**: `data-bar` is set in an effect, so the page padding appears one frame after the bar. Not visible in the mock.
6. **`webServer` in the Playwright config** makes the required E2E job build the app (about 10 to 20 seconds more) and can fail for reasons outside this task. [not checked]
7. **`:root[data-bar]` is global state**: if two bars were ever rendered at once, the first to unmount would clear it. Each page renders exactly one.
8. **`interactive-widget=resizes-visual`** is ignored by browsers that do not know it; on those (older Android browsers) the bar may ride above the keyboard and take 44 px while typing. The hide control is the user's way out.

## 6. Not checked

- A real iPhone or Android phone: the safe-area inset, the on-screen keyboard, the home-indicator area under the hidden tab. Headless Chromium has neither an inset nor a keyboard.
- Safari and Firefox rendering of the bar (only Chromium was run).
- The new components as real React code: the mock injected the final CSS and the final markup into the running app, but `AppBar.jsx`, `Icon.jsx`, `LogoutButton.jsx`, `barPref.js`, `useDismiss.js` and the tests were not run.
- The Playwright `webServer` block, in CI or locally.
- The line counts (estimates from reading the files), `npm run dup` and `npm run knip` results.
- A screen reader. The roles and attributes follow the Share button that is already on `main`.
- The dark-theme contrast of `--text-soft` on `--bg` by calculation (step 14 adds the test).
- The owner's phone numbers: his screenshot is production before T2 (one row, 96 px in the CSS); my 111 px is `main` after T2.
- Epic #111 itself was not read (no GitHub call was made); the decisions used are the ones in the brief and in the plan file.
