import { createRemoteJWKSet, jwtVerify } from 'jose'

// GitHub Actions OIDC identity for CI. Accepts a short-lived RS256 token only when every claim
// matches this repository, this workflow file and an allowed trigger. Off unless CI_OIDC_ENABLED=1.

export const OIDC_ISSUER = 'https://token.actions.githubusercontent.com'
// Each workflow may request a token; workflow_ref and job_workflow_ref must name the same file.
export const CI_WORKFLOW_PATHS = ['.github/workflows/ui-image-upload.yml', '.github/workflows/smoke-deployed.yml']
const REPO = 'Shaked/x-thread-draft-tool'
const ALLOWED_EVENTS = new Set(['workflow_dispatch', 'deployment_status'])
const MAX_TOKEN_AGE = '5m'

let jwks = createRemoteJWKSet(new URL(`${OIDC_ISSUER}/.well-known/jwks`), { timeoutDuration: 5000 })

/** Test hook: replace the key set (a local JWKS in tests). */
export function setJwksForTests(keySet) {
  jwks = keySet
}

/** The audience a CI token must carry for this deployment environment. */
export function ciAudience(vercelEnv) {
  return `x-thread-draft-tool-ci-${vercelEnv}`
}

// Central metrics (#439, M2): the ops events route accepts only the metrics-daily workflow on main.
export const OPS_WORKFLOW_PATH = '.github/workflows/metrics-daily.yml'
const OPS_WORKFLOW_REF = `${REPO}/${OPS_WORKFLOW_PATH}@refs/heads/main`
const OPS_EVENTS = new Set(['schedule', 'workflow_dispatch'])

/** The audience an ops events token must carry: its own, so a CI or smoke token never passes here. */
export function opsEventsAudience(vercelEnv) {
  return `x-thread-draft-tool-ops-events-${vercelEnv}`
}

/**
 * Returns the verified claims, or null. Never throws: every failure is "not a valid CI token".
 * Checks the signature, the audience for this environment and the required claims.
 */
async function verifySignature(token, audience) {
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: OIDC_ISSUER,
      audience,
      algorithms: ['RS256'],
      maxTokenAge: MAX_TOKEN_AGE,
      clockTolerance: '30s',
      requiredClaims: ['exp', 'iat', 'nbf', 'repository_id', 'workflow_ref', 'job_workflow_ref', 'event_name', 'ref']
    })
    return payload
  } catch (err) {
    console.warn('[oidc-ci] rejected token', err?.code ?? 'error')
    return null
  }
}

// Each refusal names its check in the log. Values are not logged, only whether they matched.
function refuse(claims, reason) {
  console.warn(`[oidc-ci] refused: ${reason} (ref=${claims.ref} event=${claims.event_name})`)
  return null
}

function workflowMatches(claims, pinned) {
  return CI_WORKFLOW_PATHS.some((p) => {
    const expected = `${REPO}/${p}@${pinned}`
    return claims.workflow_ref === expected && claims.job_workflow_ref === expected
  })
}

// Production deployment_status (no ref): the token is bound to the build that runs on main.
function isProductionBuild(claims, env, vercelEnv, ref) {
  return (
    vercelEnv === 'production' &&
    ref === '' &&
    claims.event_name === 'deployment_status' &&
    claims.sha === env.VERCEL_GIT_COMMIT_SHA &&
    env.VERCEL_GIT_COMMIT_REF === 'main'
  )
}

function isAllowedBranch(claims, env, vercelEnv, ref) {
  const branchAllowed = vercelEnv === 'preview' && env.CI_OIDC_ALLOW_BRANCHES === '1'
  return branchAllowed && (ref === '' ? claims.event_name === 'deployment_status' : /^refs\/heads\/[\w./-]+$/.test(ref))
}

export async function verifyCiToken(token, env = process.env) {
  if (env.CI_OIDC_ENABLED !== '1') return null
  const vercelEnv = env.VERCEL_ENV
  if (vercelEnv !== 'preview' && vercelEnv !== 'production') return null
  const repoId = env.CI_OIDC_REPOSITORY_ID
  if (!repoId || !/^\d+$/.test(repoId)) return null

  const claims = await verifySignature(token, ciAudience(vercelEnv))
  if (!claims) return null

  const reject = (reason) => refuse(claims, reason)
  if (claims.repository_id !== repoId) return reject('repository id does not match the configured id')
  if (!ALLOWED_EVENTS.has(claims.event_name)) return reject('event not allowed')
  if (claims.runner_environment !== undefined && claims.runner_environment !== 'github-hosted') return reject('runner not github-hosted')

  // deployment_status runs have no ref: GitHub pins workflow_ref to the commit sha instead.
  const ref = typeof claims.ref === 'string' ? claims.ref : ''
  const pinned = ref || claims.sha || ''
  if (!pinned) return reject('no ref or commit sha in token')
  if (!workflowMatches(claims, pinned)) return reject(`workflow not an allowed CI workflow (workflow_ref=${claims.workflow_ref})`)

  const isMain = ref === 'refs/heads/main'
  if (!isMain && !isAllowedBranch(claims, env, vercelEnv, ref) && !isProductionBuild(claims, env, vercelEnv, ref)) {
    return reject(`branch ref not allowed (vercelEnv=${vercelEnv} allowBranchesSet=${env.CI_OIDC_ALLOW_BRANCHES === '1'})`)
  }

  return claims
}

/**
 * Verifies an ops events token (central metrics M2): the metrics-daily workflow on main, scheduled or
 * started by hand, on a GitHub-hosted runner. Returns the claims, or null. Off unless CI_OIDC_ENABLED=1.
 */
export async function verifyOpsToken(token, env = process.env) {
  if (env.CI_OIDC_ENABLED !== '1') return null
  const vercelEnv = env.VERCEL_ENV
  if (vercelEnv !== 'preview' && vercelEnv !== 'production') return null
  const repoId = env.CI_OIDC_REPOSITORY_ID
  if (!repoId || !/^\d+$/.test(repoId)) return null

  const claims = await verifySignature(token, opsEventsAudience(vercelEnv))
  if (!claims) return null

  const reject = (reason) => refuse(claims, reason)
  if (claims.repository_id !== repoId) return reject('ops: repository id does not match the configured id')
  if (!OPS_EVENTS.has(claims.event_name)) return reject('ops: event not allowed')
  if (claims.runner_environment !== 'github-hosted') return reject('ops: runner not github-hosted')
  if (claims.ref !== 'refs/heads/main') return reject('ops: ref is not main')
  if (claims.workflow_ref !== OPS_WORKFLOW_REF || claims.job_workflow_ref !== OPS_WORKFLOW_REF) {
    return reject('ops: workflow is not metrics-daily on main')
  }
  return claims
}
