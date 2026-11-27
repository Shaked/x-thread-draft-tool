// Runs the task-janitor plugin's session-janitor with this repo's settings. The logic lives in plugins/task-janitor/scripts/.
import { pathToFileURL } from 'node:url'
import { main } from '../plugins/task-janitor/scripts/session-janitor.mjs'

export * from '../plugins/task-janitor/scripts/session-janitor.mjs'

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
