# Skill: Build and Test Workflow

Use this skill when touching UI logic, routing, exports, sharing flow, or persistence behavior.

## Required checks
1. `npm run lint`
2. `npm run test:unit`

## Optional checks
- Run `npm run dev` for manual smoke tests.
- Run `npm run test:e2e` **only when** debugging E2E-specific issues locally.

## Done criteria
- Build succeeds.
- Unit tests pass.
- Any new behavior has either unit coverage or a documented reason why not.
