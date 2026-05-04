# Skill: JS/TS Quality and Type Safety Direction

Use this skill when changing components, tests, or shared utilities.

## Current repo reality
- Codebase is primarily JSX with Vitest tests.
- TypeScript migration can be incremental and test-first.

## Guidance
- Keep component interfaces explicit and predictable.
- Prefer pure helper functions for testability.
- Add/expand tests before broad refactors.
- If introducing TS files, keep boundaries small and documented.
