---
description: Debug or work on a UI the right way: run the app locally, take screenshots at phone and desktop widths, capture errors, measure layout
---

Follow `.claude/skills/ui-debug/SKILL.md`. In short:

1. `npm run build`, start `npm run dev:api` and `npx vite preview --host 127.0.0.1 --port 4173 --strictPort` in the background.
2. Before shots and report: `node scripts/ui-shot.mjs --user <admin|user|out> --routes <list> --out docs/screenshots/<task>/before`.
3. Make the change, rebuild, then the same command with `--out docs/screenshots/<task>/after`. Look at the images.
4. Fix every failure in `report.json`; explain every warning. Stop the servers.

What to look at or fix: $ARGUMENTS
