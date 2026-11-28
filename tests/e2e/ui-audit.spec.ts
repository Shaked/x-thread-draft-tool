// UI audit, second part: the later pages of MIGRATED and the component cases. The first part is audit-early.spec.ts.
// Header and rules: ui-audit-cases.ts. Both files exist so the E2E shards get an even share of the slow audit tests (#576).
import { MIGRATED, registerComponentAudit, registerPageAudit } from './ui-audit-cases'

registerPageAudit(MIGRATED.slice(13))
registerComponentAudit()
