// Vitest reporter for the test time budget. The per-file time is the test module's task duration,
// which includes the suite's beforeAll/afterAll hooks. The JSON reporter's startTime/endTime span
// does not include them, so a file that boots a database in beforeAll looked far faster than it was.
// Import time is not included; the total wall time covers it. Rows go to TEST_BUDGET_OUT.
import { writeFileSync } from 'node:fs'

export default class TestBudgetReporter {
  rows = []

  onTestModuleEnd(testModule) {
    const d = testModule.diagnostic()
    // workerMs is what the shard really spends on the file (environment setup, setup, import, collect and tests);
    // it is what tests/shard-timings.json holds, and the CI log prints it so the table can be calibrated from CI (#634).
    const workerMs = (d.environmentSetupDuration ?? 0) + (d.setupDuration ?? 0) + (d.prepareDuration ?? 0) + (d.collectDuration ?? 0) + d.duration
    this.rows.push({ file: testModule.moduleId, ms: d.duration, workerMs })
  }

  onTestRunEnd() {
    writeFileSync(process.env.TEST_BUDGET_OUT, JSON.stringify(this.rows))
  }
}
