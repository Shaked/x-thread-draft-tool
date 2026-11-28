---
name: ui-design
description: How to add or change a page, component, colour, spacing, text size, icon or interaction with the design system (tokens, src/ui components, checklist before the PR). Read it before any UI change; read ui-debug for running the app, screenshots and error capture.
---

# Skill: UI design with the design system
Use this skill for any change to a page, component, colour, spacing, text size, icon or interaction in src/,
and for new pages (admin, view-as bar).

## The system in one screen
- Tokens: src/styles/tokens.css is the only place for colour, size, font, time, shadow and z-index values.
- Components: src/ui/, listed with props in docs/architecture/ui-components.md. Pages only compose them.
- Plan and decisions: docs/plans/ui-design-system.md (sections 2 to 4).

## Debugging and screenshots
- Run the app, sign in, take screenshots and capture errors with `.claude/skills/ui-debug/SKILL.md`. This skill does not repeat it.

## Add or change a page
1. Start from Page + PageHeader + Section. Pick the page width (narrow, default, wide).
2. Use only src/ui components and their props. No CSS file in src/pages. No style= prop.
3. Need something the kit does not have? First check the component list. Then add a prop to an existing component,
   or a new component in src/ui with a row in the list (props, states, example) in the same PR.
4. One primary button per screen. Destructive actions use variant danger or danger-quiet and useConfirm.
5. User text gets dir="auto".

## Add or change a component
1. One file src/ui/<Name>.jsx (+ <Name>.css). Class names ui-<name>, ui-<name>--<variant>.
2. Values only from tokens. Logical CSS properties only.
3. Write every state: default, hover (inside @media (hover: hover)), pressed, focus-visible, disabled
   (disabledReason), loading (same width).
4. Touch target 44 px. Transitions name their properties and use the duration tokens.
5. Update docs/architecture/ui-components.md.

## Checklist before the PR (copy into the PR body)
- [ ] npm run test:unit passes (token lint, contrast, component list).
- [ ] npx playwright test -g "UI audit" passes (it runs both audit-early.spec.ts and ui-audit.spec.ts); the page is in MIGRATED in tests/e2e/ui-audit-cases.ts.
- [ ] New scenes added to tests/e2e/screens.spec.ts; before (from a main worktree) and after shots at 390 light and
      1280 dark in docs/screenshots/ui-<task>/; the rest in the ui-audit CI artifact.
- [ ] No text or behaviour change beyond what the task says.
- [ ] Hebrew text checked (one RTL screenshot for a page that shows user text).

## How to run the checks
- npm run test:unit
- npm run build && npx vite preview --host 127.0.0.1 --port 4173 & npm run dev:api &
  then XT_BASE_URL=http://127.0.0.1:4173 npx playwright test -g "UI audit"
- npm run screens (all screenshots, see tests/e2e/screens.spec.ts)
- In a cloud session the pre-installed Chromium needs launchOptions.executablePath '/opt/pw-browsers/chromium'
  when the repo's Playwright version differs.

## Keeping this skill current
- The weekly review (#294: .claude/skills/product-care.md and docs/operations/weekly-review.md, both created by #294)
  reads this file. It checks: browser support of the CSS
  features used (light-dark(), :focus-visible, logical properties, dvh), the axe-core version and its WCAG tags,
  and the WCAG version.
- Each fact it checks gets a source URL and a "last checked" date. Facts it did not check say "not checked".
- Small text fixes: the weekly run edits and merges them after Opus validation. Any change to a rule, a token value
  or a component contract: a PR with the label `owner` (Shaked approves).
