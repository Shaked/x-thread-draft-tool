// Neon preview-branch cleanup. Dry-run by default; deletes only with an exact confirmation.
// Protected by construction: the default branch, branches flagged protected, the stable preview,
// any branch with a child branch, any branch whose git branch has an open PR, and any name that
// is not under preview/. If the default branch cannot be identified exactly, the run aborts.
//
// Neon API endpoints below are NOT yet verified against Neon's docs (not reachable from the
// agent session). Verify them before the first real run; see docs in the PR description.

export const STABLE_PREVIEW = 'preview/claude/lucid-sagan-bbciuo';
export const MAX_DELETES = 10;
export const UNMATCHED_STALE_DAYS = 7;
const PREVIEW_PREFIX = 'preview/';
const DAY_MS = 24 * 60 * 60 * 1000;

export function selectCandidates({
  neonBranches,
  openPrHeads,
  mergedPrs,
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
  // bypass the grace period of a newer one.
  const merged = new Map();
  for (const p of mergedPrs) {
    const prev = merged.get(p.head);
    if (!prev || new Date(p.merged_at).getTime() > new Date(prev.merged_at).getTime()) {
      merged.set(p.head, p);
    }
  }
  const candidates = [];
  const skipped = [];

  for (const b of neonBranches) {
    const skip = (reason) => skipped.push({ id: b.id, name: b.name, reason });
    if (b.default === true) { skip('default branch'); continue; }
    if (b.protected === true) { skip('protected branch'); continue; }
    if (typeof b.name !== 'string' || !b.name.startsWith(PREVIEW_PREFIX)) {
      skip('not a preview branch');
      continue;
    }
    if (b.name === STABLE_PREVIEW) { skip('stable preview'); continue; }
    if (parentIds.has(b.id)) { skip('has child branches'); continue; }
    const gitName = b.name.slice(PREVIEW_PREFIX.length);
    if (open.has(gitName)) { skip('open PR'); continue; }
    const pr = merged.get(gitName);
    if (pr) {
      const hours = (now - new Date(pr.merged_at).getTime()) / (60 * 60 * 1000);
      if (hours >= graceHours) {
        candidates.push({ id: b.id, name: b.name, reason: 'merged PR' });
      } else {
        skip('merged, within grace period');
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

// Thin client. Endpoints are UNVERIFIED (see header). The key is only sent in a header.
export function makeNeonClient({ apiKey, projectId, base = 'https://console.neon.tech/api/v2', fetchImpl = fetch }) {
  async function request(method, path) {
    const res = await fetchImpl(`${base}/projects/${projectId}${path}`, {
      method,
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`${method} ${path} failed with HTTP ${res.status}`);
    return res.status === 204 ? null : res.json();
  }
  return {
    // Follows pagination.next until exhausted, so the default branch and every stale branch are seen.
    async listBranches() {
      const all = [];
      let cursor = null;
      for (let page = 0; page < 100; page += 1) {
        const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
        const body = await request('GET', `/branches${query}`);
        all.push(...body.branches);
        cursor = body.pagination?.next ?? null;
        if (!cursor) return all;
      }
      throw new Error('branch pagination did not finish within 100 pages; aborting');
    },
    async deleteBranch(id) {
      return request('DELETE', `/branches/${id}`);
    },
  };
}

// argv: ['--dry-run'|'--apply', '--confirm-count=N', '--github=path.json', '--grace-hours=N']
export async function run({ argv, client, readJson, now = Date.now(), log = console.log }) {
  const opts = Object.fromEntries(
    argv.map((a) => {
      const m = a.match(/^--([^=]+)(?:=(.*))?$/);
      return m ? [m[1], m[2] ?? true] : [a, true];
    }),
  );
  const apply = opts.apply === true && opts['dry-run'] !== true;
  const graceHours = Number(opts['grace-hours'] ?? 24);
  const gh = await readJson(opts.github);
  const neonBranches = await client.listBranches();
  const { candidates, skipped } = selectCandidates({
    neonBranches,
    openPrHeads: gh.openPrHeads,
    mergedPrs: gh.mergedPrs,
    gitBranches: gh.gitBranches,
    now,
    graceHours,
  });
  log(`Neon branches: ${neonBranches.length}; candidates: ${candidates.length}`);
  for (const c of candidates) log(`CANDIDATE ${c.name} (${c.id}) reason=${c.reason}`);
  for (const s of skipped) log(`skip ${s.name} reason=${s.reason}`);

  if (!apply) {
    log('Dry run. Nothing deleted.');
    return { deleted: [], candidates };
  }
  if (String(opts['confirm-count']) !== String(candidates.length)) {
    throw new Error(`confirm-count must equal ${candidates.length}; nothing deleted`);
  }
  const deleted = [];
  for (const c of candidates) {
    await client.deleteBranch(c.id);
    deleted.push(c);
    log(`DELETED ${c.name} (${c.id})`);
  }
  return { deleted, candidates };
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
    await run({ argv, env: process.env, client, readJson });
  } catch (err) {
    console.error(String(err.message ?? err));
    process.exit(1);
  }
}
