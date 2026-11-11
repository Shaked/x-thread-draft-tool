// Neon preview-branch cleanup and preflight (hardening Task 24, docs/plans/hardening-finish.md).
//
// Modes (the first argument; plan is the default):
//   plan                         print candidates, delete nothing
//   apply --confirm-count=N      delete the candidates; N must equal their count (manual)
//   apply --auto [--only=NAME]   delete the candidates without a count (scheduled and PR-close runs)
//   preflight --branch=GIT       before a preview deploy: reuse, ok, or make room
//
// Protected by construction: the default, primary, protected or delete-restricted branch, a branch
// named main, the stable preview, any branch with a child branch, any branch whose git branch has an
// open PR, and any name not under preview/. If the default branch cannot be identified exactly, the
// run aborts.
//
// The Neon endpoints are the v2 project endpoints. They were checked against the API reference when
// Task 24 was written; the live dry run in the runbook (Task 24 step 9) is the final check.

export const STABLE_PREVIEW = 'preview/claude/lucid-sagan-bbciuo';
export const MAX_DELETES = 10;
export const UNMATCHED_STALE_DAYS = 7;
const PREVIEW_PREFIX = 'preview/';
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const FULL_MESSAGE = 'limit reached: run cleanup; never remove production or a branch still in use';

// A branch Neon or Vercel says must not go, or that is named main. Used by selection and by deleteBranch.
export function isUndeletable(b) {
  if (!b) return true;
  if (b.default === true || b.primary === true || b.protected === true) return true;
  if (b.name === 'main') return true;
  if (Array.isArray(b.restricted_actions) && b.restricted_actions.some((a) => a && a.name === 'delete')) return true;
  return false;
}

export function selectCandidates({
  neonBranches,
  openPrHeads,
  mergedPrs,
  closedPrs = [],
  gitBranches,
  now,
  graceHours = 24,
  maxDeletes = MAX_DELETES,
}) {
  const defaults = neonBranches.filter((b) => b.default === true);
  if (defaults.length !== 1) {
    throw new Error(`expected exactly one default branch, found ${defaults.length}; aborting`);
  }
  const parentIds = new Set(neonBranches.map((b) => b.parent_id).filter(Boolean));
  const open = new Set(openPrHeads);
  const git = new Set(gitBranches);
  // A git branch can have several merged PRs. Keep the most recent merge so an old PR cannot
  // bypass the grace period of a newer one. The same goes for closed PRs.
  const merged = latestBy(mergedPrs, (p) => p.merged_at);
  const closed = latestBy(closedPrs, (p) => p.closed_at);
  const candidates = [];
  const skipped = [];

  for (const b of neonBranches) {
    const skip = (reason) => skipped.push({ id: b.id, name: b.name, reason });
    if (b.default === true) { skip('default branch'); continue; }
    if (isUndeletable(b)) { skip('protected branch'); continue; }
    if (typeof b.name !== 'string' || !b.name.startsWith(PREVIEW_PREFIX)) {
      skip('not a preview branch');
      continue;
    }
    if (b.name === STABLE_PREVIEW) { skip('stable preview'); continue; }
    if (parentIds.has(b.id)) { skip('has child branches'); continue; }
    const gitName = b.name.slice(PREVIEW_PREFIX.length);
    // An open PR protects the branch even if it also has a closed PR.
    if (open.has(gitName)) { skip('open PR'); continue; }
    const pr = merged.get(gitName);
    if (pr) {
      const hours = (now - new Date(pr.merged_at).getTime()) / HOUR_MS;
      if (hours >= graceHours) {
        candidates.push({ id: b.id, name: b.name, reason: 'merged PR' });
      } else {
        skip('merged, within grace period');
      }
      continue;
    }
    const closedPr = closed.get(gitName);
    if (closedPr) {
      const hours = (now - new Date(closedPr.closed_at).getTime()) / HOUR_MS;
      if (hours >= graceHours) {
        candidates.push({ id: b.id, name: b.name, reason: 'closed PR' });
      } else {
        skip('closed PR, within grace period');
      }
      continue;
    }
    const ageDays = (now - new Date(b.created_at).getTime()) / DAY_MS;
    if (!git.has(gitName) && ageDays >= UNMATCHED_STALE_DAYS) {
      candidates.push({ id: b.id, name: b.name, reason: 'git branch gone' });
      continue;
    }
    skip('in use or too recent');
  }

  if (candidates.length > maxDeletes) {
    throw new Error(`${candidates.length} candidates exceeds the cap of ${maxDeletes}; aborting`);
  }
  return { candidates, skipped };
}

function latestBy(items, dateOf) {
  const map = new Map();
  for (const p of items) {
    const key = p.head;
    const prev = map.get(key);
    if (!prev || new Date(dateOf(p)).getTime() > new Date(dateOf(prev)).getTime()) map.set(key, p);
  }
  return map;
}

// vercel.json git.deploymentEnabled: patterns use * (no slash) and ** (anything). Any matching true wins;
// otherwise a matching false disables the branch. No match leaves Vercel's default (deploy).
export function globMatch(pattern, value) {
  const escape = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const source = pattern
    .split('**')
    .map((part) => part.split('*').map(escape).join('[^/]*'))
    .join('.*');
  return new RegExp(`^${source}$`).test(value);
}

export function vercelDisablesBranch(config, branch) {
  const rules = config?.git?.deploymentEnabled ?? {};
  let disabled = false;
  for (const [pattern, enabled] of Object.entries(rules)) {
    if (!globMatch(pattern, branch)) continue;
    if (enabled === true) return false;
    disabled = true;
  }
  return disabled;
}

const RETRY_DELAYS_MS = [2000, 4000, 8000];

// Thin client. The key is only sent in a header and never appears in an error message.
export function makeNeonClient({
  apiKey,
  projectId,
  base = 'https://console.neon.tech/api/v2',
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  // The last listed record of each branch id. deleteBranch refuses an id whose record is undeletable.
  const lastSeen = new Map();

  async function request(method, path) {
    const res = await fetchImpl(`${base}/projects/${projectId}${path}`, {
      method,
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    });
    if (res.status === 204) return null;
    if (!res.ok) {
      const err = new Error(`${method} ${path} failed with HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  return {
    async getProject() {
      return request('GET', '');
    },
    // Follows pagination.next until exhausted, so the default branch and every stale branch are seen.
    async listBranches() {
      const all = [];
      let cursor = null;
      for (let page = 0; page < 100; page += 1) {
        const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
        const body = await request('GET', `/branches${query}`);
        all.push(...body.branches);
        cursor = body.pagination?.next ?? null;
        if (!cursor) {
          lastSeen.clear();
          for (const b of all) lastSeen.set(b.id, b);
          return all;
        }
      }
      throw new Error('branch pagination did not finish within 100 pages; aborting');
    },
    // Returns { alreadyDeleted: true } on 404. Retries HTTP 423 (operation in progress) three times.
    async deleteBranch(id) {
      const record = lastSeen.get(id);
      if (!record) throw new Error(`refusing to delete ${id}: branch not in the last listing`);
      if (isUndeletable(record)) throw new Error(`refusing to delete ${id}: branch is protected`);
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await request('DELETE', `/branches/${id}`);
        } catch (err) {
          if (err.status === 404) return { alreadyDeleted: true };
          if (err.status === 423 && attempt < RETRY_DELAYS_MS.length) {
            await sleep(RETRY_DELAYS_MS[attempt]);
            continue;
          }
          throw err;
        }
      }
    },
  };
}

async function branchLimit(client, env) {
  const project = client.getProject ? await client.getProject() : null;
  const fromApi = project?.project?.owner?.branches_limit;
  if (Number.isInteger(fromApi) && fromApi > 0) return fromApi;
  const fromEnv = Number(env?.NEON_BRANCH_LIMIT);
  if (Number.isInteger(fromEnv) && fromEnv > 0) return fromEnv;
  throw new Error('branch limit unknown; aborting');
}

function parseOptions(args) {
  return Object.fromEntries(
    args.map((a) => {
      const m = a.match(/^--([^=]+)(?:=(.*))?$/);
      return m ? [m[1], m[2] ?? true] : [a, true];
    }),
  );
}

export async function run({
  argv,
  env = {},
  client,
  readJson,
  now = Date.now(),
  log = console.log,
  err = console.error,
}) {
  const args = [...argv];
  const first = args[0];
  const explicitMode = first && !first.startsWith('--') ? args.shift() : null;
  const opts = parseOptions(args);
  const mode = explicitMode ?? (opts.apply === true && opts['dry-run'] !== true ? 'apply' : 'plan');
  if (!['plan', 'apply', 'preflight'].includes(mode)) throw new Error(`unknown mode ${mode}`);

  const graceHours = Number(opts['grace-hours'] ?? 24);
  const gh = await readJson(opts.github);
  const limit = await branchLimit(client, env);
  let neonBranches = await client.listBranches();
  const select = (list) =>
    selectCandidates({
      neonBranches: list,
      openPrHeads: gh.openPrHeads,
      mergedPrs: gh.mergedPrs,
      closedPrs: gh.closedPrs ?? [],
      gitBranches: gh.gitBranches,
      now,
      graceHours,
    });
  const logCandidates = (candidates, skipped) => {
    for (const c of candidates) log(`CANDIDATE ${c.name} (${c.id}) reason=${c.reason}`);
    for (const s of skipped) log(`skip ${s.name} reason=${s.reason}`);
  };
  const deleteAll = async (candidates) => {
    const deleted = [];
    for (const c of candidates) {
      const result = await client.deleteBranch(c.id);
      if (result && result.alreadyDeleted) {
        log(`already deleted ${c.name} (${c.id})`);
        continue;
      }
      deleted.push(c);
      log(`DELETED ${c.name} (${c.id})`);
    }
    return deleted;
  };

  if (mode === 'plan') {
    const { candidates, skipped } = select(neonBranches);
    log(`Neon branches: ${neonBranches.length}; limit: ${limit}; candidates: ${candidates.length}`);
    logCandidates(candidates, skipped);
    log('Dry run. Nothing deleted.');
    return { deleted: [], candidates, exitCode: 0 };
  }

  if (mode === 'apply' && opts.auto !== true) {
    const { candidates, skipped } = select(neonBranches);
    log(`Neon branches: ${neonBranches.length}; limit: ${limit}; candidates: ${candidates.length}`);
    logCandidates(candidates, skipped);
    if (String(opts['confirm-count']) !== String(candidates.length)) {
      throw new Error(`confirm-count must equal ${candidates.length}; nothing deleted`);
    }
    const deleted = await deleteAll(candidates);
    return { deleted, candidates, exitCode: 0 };
  }

  if (mode === 'apply') {
    let { candidates } = select(neonBranches);
    if (typeof opts.only === 'string') candidates = candidates.filter((c) => c.name === opts.only);
    const deleted = await deleteAll(candidates);
    neonBranches = await client.listBranches();
    log(`after: ${neonBranches.length}/${limit}`);
    return { deleted, candidates, exitCode: 0 };
  }

  // preflight: the preview branch check, see runPreflight.
  return runPreflight({ opts, client, readJson, neonBranches, limit, select, logCandidates, deleteAll, log, err });
}

async function runPreflight({ opts, client, readJson, neonBranches, limit, select, logCandidates, deleteAll, log, err }) {
  if (typeof opts.branch !== 'string' || opts.branch.length === 0) {
    throw new Error('preflight needs --branch=<git branch>');
  }
  const branch = opts.branch;
  const vercelConfig = await readJson(opts['vercel-config'] ?? 'vercel.json');
  if (vercelDisablesBranch(vercelConfig, branch)) {
    log('no preview for this branch (vercel.json)');
    return { deleted: [], candidates: [], exitCode: 0 };
  }
  const name = `${PREVIEW_PREFIX}${branch}`;
  const existing = neonBranches.find((b) => b.name === name);
  if (existing) {
    log(`reuse ${name} (${existing.id})`);
    return { deleted: [], candidates: [], exitCode: 0 };
  }
  if (neonBranches.length < limit) {
    log(`ok ${neonBranches.length}/${limit}`);
    return { deleted: [], candidates: [], exitCode: 0 };
  }
  const { candidates, skipped } = select(neonBranches);
  let deleted = [];
  if (opts['cleanup-on-full'] === true) {
    deleted = await deleteAll(candidates);
    neonBranches = await client.listBranches();
    if (neonBranches.length < limit) {
      log(`ok ${neonBranches.length}/${limit}`);
      return { deleted, candidates, exitCode: 0 };
    }
  } else {
    logCandidates(candidates, skipped);
  }
  err(FULL_MESSAGE);
  return { deleted, candidates, exitCode: 2 };
}

// CLI entry. Reads NEON_API_KEY and NEON_PROJECT_ID from the environment (never from argv).
if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFile } = await import('node:fs/promises');
  const apiKey = process.env.NEON_API_KEY;
  const projectId = process.env.NEON_PROJECT_ID;
  if (!apiKey || !projectId) {
    console.error('NEON_API_KEY and NEON_PROJECT_ID must be set; nothing done.');
    process.exit(1);
  }
  const argv = process.argv.slice(2);
  const client = makeNeonClient({ apiKey, projectId });
  const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));
  try {
    const result = await run({ argv, env: process.env, client, readJson });
    process.exitCode = result.exitCode;
  } catch (err) {
    console.error(String(err.message ?? err));
    process.exit(1);
  }
}
