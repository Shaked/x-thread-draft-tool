// UI audit, first part: the first pages of MIGRATED. The rest is ui-audit.spec.ts. This file sorts early on purpose:
// Playwright's --shard cuts the tests in file order, so the slow audit tests are spread over the E2E shards (#576).
import { MIGRATED, registerPageAudit } from './ui-audit-cases'

registerPageAudit(MIGRATED.slice(0, 13))
