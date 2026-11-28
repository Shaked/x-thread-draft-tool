// UI audit, first part: the first pages of MIGRATED. The rest is ui-audit.spec.ts. This file sorts early on purpose:
// Playwright's --shard cuts the tests in file order, so the slow audit tests are spread over the E2E shards (#576).
import { MIGRATED, registerPageAudit } from './ui-audit-cases'

// The split index 13 is shared with ui-audit.spec.ts (MIGRATED.slice(13)). The balance between the E2E shards drifts as pages
// are added: re-measure the four shards (`npx playwright test --project=chromium --shard=n/4`) and move the number in BOTH files.
registerPageAudit(MIGRATED.slice(0, 13))
