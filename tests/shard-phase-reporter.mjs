// Vitest reporter for tests/regen-shard-timings.mjs (#605). A file's worker time is its environment setup,
// setup, prepare, collect and test phases, which is what a shard really spends on it. Rows go to SHARD_TIMINGS_OUT.
import { writeFileSync } from 'node:fs'

export default class ShardPhaseReporter {
  rows = []

  onTestModuleEnd(testModule) {
    const d = testModule.diagnostic()
    const ms = (d.environmentSetupDuration ?? 0) + (d.setupDuration ?? 0) + (d.prepareDuration ?? 0) + (d.collectDuration ?? 0) + (d.duration ?? 0)
    this.rows.push({ file: testModule.moduleId, ms })
  }

  onTestRunEnd() {
    writeFileSync(process.env.SHARD_TIMINGS_OUT, JSON.stringify(this.rows))
  }
}
