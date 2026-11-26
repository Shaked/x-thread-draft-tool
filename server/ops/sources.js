// Central metrics plan M1 (#439, task #447): the repos whose events the ops tables accept.
// Each entry is one public repo. repository_id is GitHub's numeric id: a renamed or re-created repo
// cannot take this id. workflows are the CI workflow names that get rows; other runs are counted, not stored.
// speed is true only where scripts/speed-metrics.mjs knows the workflow names.
export const SOURCES = [
  {
    owner: 'Shaked',
    name: 'x-thread-draft-tool',
    repository_id: 1136002672,
    workflows: ['Tests', 'Smoke test (deployed)'],
    speed: true
  }
]

/** The listed repo with this numeric id, or null. */
export function findRepo(repositoryId, sources = SOURCES) {
  return sources.find((repo) => repo.repository_id === repositoryId) ?? null
}

/** "owner/name" of a listed repo. */
export function fullName(repo) {
  return `${repo.owner}/${repo.name}`
}
