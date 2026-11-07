import { createRemoteJWKSet, jwtVerify } from 'jose'

// GitHub Actions OIDC identity for CI. Accepts a short-lived RS256 token only when every claim
// matches this repository, this workflow file and an allowed trigger. Off unless CI_OIDC_ENABLED=1.

export const OIDC_ISSUER = 'https://token.actions.githubusercontent.com'
export const CI_WORKFLOW_PATH = '.github/workflows/ui-image-upload.yml'
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

/**
 * Returns the verified claims, or null. Never throws: every failure is "not a valid CI token".
 * env: process env. Only preview and production deployments accept CI tokens.
 */
export async function verifyCiToken(token, env = process.env) {
  if (env.CI_OIDC_ENABLED !== '1') return null
  const vercelEnv = env.VERCEL_ENV
  if (vercelEnv !== 'preview' && vercelEnv !== 'production') return null
  const repoId = env.CI_OIDC_REPOSITORY_ID
  if (!repoId || !/^\d+$/.test(repoId)) return null

  let claims
  try {
    ;({ payload: claims } = await jwtVerify(token, jwks, {
      issuer: OIDC_ISSUER,
      audience: ciAudience(vercelEnv),
      algorithms: ['RS256'],
      maxTokenAge: MAX_TOKEN_AGE,
      clockTolerance: '30s',
      requiredClaims: ['exp', 'iat', 'nbf', 'repository_id', 'workflow_ref', 'job_workflow_ref', 'event_name', 'ref']
    }))
  } catch (err) {
    console.warn('[oidc-ci] rejected token', err?.code ?? 'error')
    return null
  }

  // Each refusal names its check in the log. Values are not logged, only whether they matched.
  const reject = (reason) => {
    console.warn(`[oidc-ci] refused: ${reason} (ref=${claims.ref} event=${claims.event_name})`)
    return null
  }
  if (claims.repository_id !== repoId) return reject('repository id does not match the configured id')
  if (!ALLOWED_EVENTS.has(claims.event_name)) return reject('event not allowed')
  if (claims.runner_environment !== undefined && claims.runner_environment !== 'github-hosted') return reject('runner not github-hosted')

  const expectedWorkflow = `${REPO}/${CI_WORKFLOW_PATH}@${claims.ref}`
  if (claims.workflow_ref !== expectedWorkflow) return reject(`workflow_ref mismatch (got ${claims.workflow_ref})`)
  if (claims.job_workflow_ref !== expectedWorkflow) return reject(`job_workflow_ref mismatch (got ${claims.job_workflow_ref})`)

  const isMain = claims.ref === 'refs/heads/main'
  const isBranch =
    vercelEnv === 'preview' && env.CI_OIDC_ALLOW_BRANCHES === '1' && /^refs\/heads\/[\w./-]+$/.test(claims.ref)
  if (!isMain && !isBranch) {
    return reject(`branch ref not allowed (vercelEnv=${vercelEnv} allowBranchesSet=${env.CI_OIDC_ALLOW_BRANCHES === '1'})`)
  }

  return claims
}
