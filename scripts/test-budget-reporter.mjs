// Vitest reporter for the test time budget. The per-file time is the test module's task duration,
// which includes the suite's beforeAll/afterAll hooks. The JSON reporter's startTime/endTime span
// does not include them, so a file that boots a database in beforeAll looked far faster than it was.
// Import time is not included; the total wall time covers it. Rows go to TEST_BUDGET_OUT.
import { writeFileSync } from 'node:fs'

export default class TestBudgetReporter {
  rows = []

  onTestModuleEnd(testModule) {
    this.rows.push({ file: testModule.moduleId, ms: testModule.diagnostic().duration })
  }

  onTestRunEnd() {
    writeFileSync(process.env.TEST_BUDGET_OUT, JSON.stringify(this.rows))
  }
}
