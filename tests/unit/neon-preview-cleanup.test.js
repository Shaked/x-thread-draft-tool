import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import {
  selectCandidates,
  run,
  makeNeonClient,
  isUndeletable,
  globMatch,
  vercelDisablesBranch,
  STABLE_PREVIEW,
  MAX_DELETES,
} from '../../scripts/neon-preview-cleanup.mjs';

const NOW = Date.parse('2026-11-08T12:00:00Z');
const OLD = '2026-10-01T00:00:00Z';
const RECENT = '2026-11-08T11:00:00Z';
const DEFAULT = { id: 'br-default', name: 'production', default: true, created_at: OLD };
const MAIN = {
  id: 'br-spring-glade-bbc3zlza',
  name: 'main',
  default: true,
  primary: true,
  protected: false,
  restricted_actions: [{ name: 'delete', reason: 'vercel production branch' }],
  created_at: OLD,
};

function base(overrides = {}) {
  return {
    neonBranches: [DEFAULT],
    openPrHeads: [],
    mergedPrs: [],
    closedPrs: [],
    gitBranches: ['main'],
    now: NOW,
    ...overrides,
  };
}

// In-memory client: listing reflects deletions, like the real API.
function mockClient(neonBranches, { limit = 10 } = {}) {
  let state = neonBranches.map((b) => ({ ...b }));
  const deletes = [];
  return {
    getProject: vi.fn(async () => ({ project: { owner: { branches_limit: limit } } })),
    listBranches: vi.fn(async () => state.map((b) => ({ ...b }))),
    deleteBranch: vi.fn(async (id) => {
      deletes.push(id);
      state = state.filter((b) => b.id !== id);
      return null;
    }),
    deletes,
  };
}

function ghState(overrides = {}) {
  return { openPrHeads: [], mergedPrs: [], closedPrs: [], gitBranches: ['main'], ...overrides };
}

// Ten branches: main plus nine preview branches that are all in use (open PR), so there is no room.
function fullBranches(extra = []) {
  const inUse = [];
  for (let i = 0; i < 9 - extra.length; i += 1) {
    inUse.push({ id: `u${i}`, name: `preview/claude/busy-${i}`, created_at: RECENT });
  }
  return [DEFAULT, ...inUse, ...extra];
}
const FULL_OPEN_PRS = Array.from({ length: 9 }, (_, i) => `claude/busy-${i}`);

const FULL_MSG = 'limit reached: run cleanup; never remove production or a branch still in use';

describe('selectCandidates: default branch', () => {
  it('never selects the default branch', () => {
    const { candidates } = selectCandidates(base());
    expect(candidates).toEqual([]);
  });

  it.each([
    ['no default flag', [{ id: 'a', name: 'preview/x', created_at: OLD }]],
    ['zero defaults', [{ id: 'a', name: 'preview/x', default: false, created_at: OLD }]],
    ['two defaults', [DEFAULT, { id: 'b', name: 'other', default: true, created_at: OLD }]],
  ])('aborts when the default branch is not exactly one (%s)', (_label, neonBranches) => {
    expect(() => selectCandidates(base({ neonBranches }))).toThrow(/exactly one default branch/);
  });
});

describe('selectCandidates: protected names', () => {
  it('never selects the stable preview, even when its PR is merged long ago', () => {
    const neonBranches = [DEFAULT, { id: 'st', name: STABLE_PREVIEW, created_at: OLD }];
    const mergedPrs = [{ head: 'claude/lucid-sagan-bbciuo', merged_at: OLD }];
    const { candidates, skipped } = selectCandidates(base({ neonBranches, mergedPrs }));
    expect(candidates).toEqual([]);
    expect(skipped.find((s) => s.name === STABLE_PREVIEW).reason).toBe('stable preview');
  });

  it('never selects a branch that is not under preview/', () => {
    const neonBranches = [DEFAULT, { id: 'x', name: 'staging', created_at: OLD }];
    const { candidates } = selectCandidates(base({ neonBranches }));
    expect(candidates).toEqual([]);
  });

  it('never selects a protected branch', () => {
    const neonBranches = [DEFAULT, { id: 'p', name: 'preview/claude/p', protected: true, created_at: OLD }];
    const mergedPrs = [{ head: 'claude/p', merged_at: OLD }];
    expect(selectCandidates(base({ neonBranches, mergedPrs })).candidates).toEqual([]);
  });

  it('never selects a child-parent branch', () => {
    const neonBranches = [
      DEFAULT,
      { id: 'parent', name: 'preview/claude/parent', created_at: OLD },
      { id: 'child', name: 'preview/claude/child', parent_id: 'parent', created_at: OLD },
    ];
    const mergedPrs = [{ head: 'claude/parent', merged_at: OLD }];
    const { candidates, skipped } = selectCandidates(base({ neonBranches, mergedPrs }));
    expect(candidates.map((c) => c.name)).not.toContain('preview/claude/parent');
    expect(skipped.find((s) => s.name === 'preview/claude/parent').reason).toBe('has child branches');
  });
});

describe('selectCandidates: open PRs and grace', () => {
  it('never selects a branch whose git branch has an open PR', () => {
    const neonBranches = [DEFAULT, { id: 'o', name: 'preview/claude/open-one', created_at: OLD }];
    const mergedPrs = [{ head: 'claude/open-one', merged_at: OLD }];
    const openPrHeads = ['claude/open-one'];
    expect(selectCandidates(base({ neonBranches, mergedPrs, openPrHeads })).candidates).toEqual([]);
  });

  it('selects a merged PR branch once the grace period has passed', () => {
    const neonBranches = [DEFAULT, { id: 'm', name: 'preview/claude/done', created_at: OLD }];
    const mergedPrs = [{ head: 'claude/done', merged_at: '2026-11-06T00:00:00Z' }];
    const { candidates } = selectCandidates(base({ neonBranches, mergedPrs, graceHours: 24 }));
    expect(candidates).toEqual([{ id: 'm', name: 'preview/claude/done', reason: 'merged PR' }]);
  });

  it('keeps a merged PR branch inside the grace period', () => {
    const neonBranches = [DEFAULT, { id: 'm', name: 'preview/claude/fresh', created_at: OLD }];
    const mergedPrs = [{ head: 'claude/fresh', merged_at: RECENT }];
    expect(selectCandidates(base({ neonBranches, mergedPrs, graceHours: 24 })).candidates).toEqual([]);
  });

  it('selects an unmatched branch only when its git branch is gone and it is old enough', () => {
    const neonBranches = [
      DEFAULT,
      { id: 'g', name: 'preview/claude/gone-old', created_at: OLD },
      { id: 'n', name: 'preview/claude/gone-new', created_at: RECENT },
    ];
    const { candidates } = selectCandidates(base({ neonBranches }));
    expect(candidates.map((c) => c.id)).toEqual(['g']);
  });
});

describe('selectCandidates: closed PRs (T7)', () => {
  it('selects a closed, unmerged PR past the grace period', () => {
    const neonBranches = [DEFAULT, { id: 'c', name: 'preview/claude/abandoned', created_at: OLD }];
    const closedPrs = [{ head: 'claude/abandoned', closed_at: '2026-11-06T00:00:00Z' }];
    const { candidates } = selectCandidates(base({ neonBranches, closedPrs, graceHours: 24 }));
    expect(candidates).toEqual([{ id: 'c', name: 'preview/claude/abandoned', reason: 'closed PR' }]);
  });

  it('skips a closed, unmerged PR inside the grace period', () => {
    const neonBranches = [DEFAULT, { id: 'c', name: 'preview/claude/just-closed', created_at: OLD }];
    const closedPrs = [{ head: 'claude/just-closed', closed_at: RECENT }];
    const { candidates, skipped } = selectCandidates(base({ neonBranches, closedPrs, graceHours: 24 }));
    expect(candidates).toEqual([]);
    expect(skipped.find((s) => s.name === 'preview/claude/just-closed').reason).toBe('closed PR, within grace period');
  });

  it('keeps a branch that has both an open and a closed PR', () => {
    const neonBranches = [DEFAULT, { id: 'b', name: 'preview/claude/both', created_at: OLD }];
    const closedPrs = [{ head: 'claude/both', closed_at: '2026-11-01T00:00:00Z' }];
    const openPrHeads = ['claude/both'];
    expect(selectCandidates(base({ neonBranches, closedPrs, openPrHeads })).candidates).toEqual([]);
  });
});

describe('isUndeletable', () => {
  it.each([
    ['default', { default: true }],
    ['primary', { primary: true }],
    ['protected', { protected: true }],
    ['delete-restricted', { restricted_actions: [{ name: 'delete' }] }],
    ['named main', { name: 'main' }],
  ])('treats a %s branch as undeletable', (_label, fields) => {
    expect(isUndeletable({ id: 'x', name: 'preview/claude/x', ...fields })).toBe(true);
  });

  it('allows an ordinary preview branch', () => {
    expect(isUndeletable({ id: 'x', name: 'preview/claude/x', created_at: OLD })).toBe(false);
  });
});

describe('selectCandidates: cap', () => {
  it('aborts when candidates exceed the cap', () => {
    const neonBranches = [DEFAULT];
    for (let i = 0; i < MAX_DELETES + 1; i += 1) {
      neonBranches.push({ id: `c${i}`, name: `preview/claude/old-${i}`, created_at: OLD });
    }
    expect(() => selectCandidates(base({ neonBranches }))).toThrow(/exceeds the cap/);
  });
});

describe('selectCandidates: duplicate merged heads', () => {
  it('uses the most recent merge for a branch, so an old PR cannot bypass the grace period', () => {
    const neonBranches = [DEFAULT, { id: 'd', name: 'preview/claude/reused', created_at: OLD }];
    const mergedPrs = [
      { head: 'claude/reused', merged_at: '2026-11-08T11:00:00Z' },
      { head: 'claude/reused', merged_at: '2026-10-01T00:00:00Z' },
    ];
    const { candidates } = selectCandidates(base({ neonBranches, mergedPrs, graceHours: 24 }));
    expect(candidates).toEqual([]);
  });
});

describe('run: plan and manual apply (T1)', () => {
  const neonBranches = [DEFAULT, { id: 'm', name: 'preview/claude/done', created_at: OLD }];
  const readJson = async () => ghState({ mergedPrs: [{ head: 'claude/done', merged_at: '2026-11-06T00:00:00Z' }] });

  it('T1: plan with candidates makes no DELETE calls and says so', async () => {
    const c = mockClient(neonBranches);
    const lines = [];
    const out = await run({ argv: ['plan', '--github=x'], env: {}, client: c, readJson, now: NOW, log: (l) => lines.push(l) });
    expect(out.candidates).toHaveLength(1);
    expect(c.deletes).toEqual([]);
    expect(lines).toContain('Dry run. Nothing deleted.');
    expect(lines.some((l) => l.startsWith('Neon branches: 2; limit: 10; candidates: 1'))).toBe(true);
  });

  it('--dry-run still means plan', async () => {
    const c = mockClient(neonBranches);
    await run({ argv: ['--dry-run', '--github=x'], env: {}, client: c, readJson, now: NOW, log: () => {} });
    expect(c.deletes).toEqual([]);
  });

  it('apply with the wrong confirm count deletes nothing', async () => {
    const c = mockClient(neonBranches);
    await expect(
      run({ argv: ['apply', '--confirm-count=5', '--github=x'], env: {}, client: c, readJson, now: NOW, log: () => {} }),
    ).rejects.toThrow(/confirm-count must equal 1/);
    expect(c.deletes).toEqual([]);
  });

  it('apply with the exact confirm count deletes only the candidates', async () => {
    const c = mockClient(neonBranches);
    await run({ argv: ['apply', '--confirm-count=1', '--github=x'], env: {}, client: c, readJson, now: NOW, log: () => {} });
    expect(c.deletes).toEqual(['m']);
  });

  it('never prints the API key', async () => {
    const lines = [];
    const c = mockClient(neonBranches);
    await run({ argv: ['plan', '--github=x'], env: { NEON_API_KEY: 'SECRET-KEY-123' }, client: c, readJson, now: NOW, log: (l) => lines.push(l) });
    expect(lines.join('\n')).not.toContain('SECRET-KEY-123');
  });

  it('aborts when the branch limit is unknown (API and env both missing)', async () => {
    const c = mockClient(neonBranches);
    c.getProject = vi.fn(async () => ({ project: { owner: {} } }));
    await expect(run({ argv: ['plan', '--github=x'], env: {}, client: c, readJson, now: NOW, log: () => {} })).rejects.toThrow(/branch limit unknown/);
  });

  it('falls back to NEON_BRANCH_LIMIT when the API has no limit', async () => {
    const c = mockClient(neonBranches);
    c.getProject = vi.fn(async () => ({ project: { owner: {} } }));
    const lines = [];
    await run({ argv: ['plan', '--github=x'], env: { NEON_BRANCH_LIMIT: '7' }, client: c, readJson, now: NOW, log: (l) => lines.push(l) });
    expect(lines.some((l) => l.includes('limit: 7'))).toBe(true);
  });
});

describe('run: preflight (T2, T2b, T2c, T3, T8)', () => {
  it('T2: at 10/10 with no candidates, exits 2 with the exact message on stderr', async () => {
    const c = mockClient(fullBranches());
    const errs = [];
    const readJson = async (p) => (p === 'vercel.json' ? { git: { deploymentEnabled: {} } } : ghState({ openPrHeads: FULL_OPEN_PRS }));
    const out = await run({ argv: ['preflight', '--branch=claude/new'], env: {}, client: c, readJson, now: NOW, log: () => {}, err: (m) => errs.push(m) });
    expect(out.exitCode).toBe(2);
    expect(errs).toEqual([FULL_MSG]);
    expect(c.deletes).toEqual([]);
  });

  it('T2b: at 10/10 with one merged candidate and --cleanup-on-full, deletes 1 and reports ok 9/10', async () => {
    const done = { id: 'done', name: 'preview/claude/done', created_at: OLD };
    const c = mockClient(fullBranches([done]));
    const lines = [];
    const readJson = async (p) =>
      p === 'vercel.json'
        ? { git: { deploymentEnabled: {} } }
        : ghState({ openPrHeads: FULL_OPEN_PRS.slice(0, 8), mergedPrs: [{ head: 'claude/done', merged_at: '2026-11-06T00:00:00Z' }] });
    const out = await run({
      argv: ['preflight', '--branch=claude/new', '--cleanup-on-full'],
      env: {},
      client: c,
      readJson,
      now: NOW,
      log: (l) => lines.push(l),
      err: () => {},
    });
    expect(out.exitCode).toBe(0);
    expect(c.deletes).toEqual(['done']);
    expect(lines).toContain('ok 9/10');
  });

  it('T2c: at 10/10 with a candidate and no flag, lists the candidate, exits 2 with the message', async () => {
    const done = { id: 'done', name: 'preview/claude/done', created_at: OLD };
    const c = mockClient(fullBranches([done]));
    const lines = [];
    const errs = [];
    const readJson = async (p) =>
      p === 'vercel.json'
        ? { git: { deploymentEnabled: {} } }
        : ghState({ openPrHeads: FULL_OPEN_PRS.slice(0, 8), mergedPrs: [{ head: 'claude/done', merged_at: '2026-11-06T00:00:00Z' }] });
    const out = await run({
      argv: ['preflight', '--branch=claude/new'],
      env: {},
      client: c,
      readJson,
      now: NOW,
      log: (l) => lines.push(l),
      err: (m) => errs.push(m),
    });
    expect(out.exitCode).toBe(2);
    expect(lines.some((l) => l.startsWith('CANDIDATE preview/claude/done'))).toBe(true);
    expect(errs).toEqual([FULL_MSG]);
    expect(c.deletes).toEqual([]);
  });

  it('T3: reuses an existing preview branch even at 10/10, with no DELETE', async () => {
    const mine = { id: 'mine', name: 'preview/claude/new', created_at: RECENT };
    const c = mockClient(fullBranches([mine]));
    const lines = [];
    const readJson = async (p) => (p === 'vercel.json' ? { git: { deploymentEnabled: {} } } : ghState());
    const out = await run({ argv: ['preflight', '--branch=claude/new'], env: {}, client: c, readJson, now: NOW, log: (l) => lines.push(l), err: () => {} });
    expect(out.exitCode).toBe(0);
    expect(lines).toContain('reuse preview/claude/new (mine)');
    expect(c.deletes).toEqual([]);
  });

  it('T8: a branch that vercel.json disables gets no preview', async () => {
    const c = mockClient([DEFAULT]);
    const lines = [];
    const readJson = async (p) =>
      p === 'vercel.json'
        ? { git: { deploymentEnabled: { 'claude/**': false, 'codex/**': false, 'claude/lucid-sagan-bbciuo': true } } }
        : ghState();
    const out = await run({ argv: ['preflight', '--branch=claude/x'], env: {}, client: c, readJson, now: NOW, log: (l) => lines.push(l), err: () => {} });
    expect(out.exitCode).toBe(0);
    expect(lines).toContain('no preview for this branch (vercel.json)');
  });

  it('preflight needs --branch', async () => {
    const c = mockClient([DEFAULT]);
    await expect(run({ argv: ['preflight'], env: {}, client: c, readJson: async () => ghState(), now: NOW, log: () => {} })).rejects.toThrow(/--branch/);
  });
});

describe('vercel.json matching', () => {
  it('* stays inside one path segment; ** crosses slashes', () => {
    expect(globMatch('claude/*', 'claude/x')).toBe(true);
    expect(globMatch('claude/*', 'claude/x/y')).toBe(false);
    expect(globMatch('claude/**', 'claude/x/y')).toBe(true);
  });

  it('a matching true entry wins over a matching false entry', () => {
    const cfg = { git: { deploymentEnabled: { 'claude/**': false, 'claude/lucid-sagan-bbciuo': true } } };
    expect(vercelDisablesBranch(cfg, 'claude/lucid-sagan-bbciuo')).toBe(false);
    expect(vercelDisablesBranch(cfg, 'claude/other')).toBe(true);
  });

  it('no matching rule leaves the default (deploy)', () => {
    expect(vercelDisablesBranch({ git: { deploymentEnabled: { 'codex/**': false } } }, 'feature/x')).toBe(false);
  });
});

describe('makeNeonClient: pagination', () => {
  it('collects every page until pagination.next is empty', async () => {
    const pages = [
      { branches: [DEFAULT], pagination: { next: 'c2' } },
      { branches: [{ id: 'x', name: 'preview/claude/x' }], pagination: { next: 'c3' } },
      { branches: [{ id: 'y', name: 'preview/claude/y' }] },
    ];
    const seen = [];
    const fetchImpl = vi.fn(async (url) => {
      seen.push(url);
      return { ok: true, status: 200, json: async () => pages[seen.length - 1] };
    });
    const client = makeNeonClient({ apiKey: 'k', projectId: 'p', base: 'https://example.test/api', fetchImpl });
    const all = await client.listBranches();
    expect(all.map((b) => b.id)).toEqual(['br-default', 'x', 'y']);
    expect(seen[1]).toContain('cursor=c2');
    expect(seen[2]).toContain('cursor=c3');
  });

  it('never includes the API key in an error message', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) }));
    const client = makeNeonClient({ apiKey: 'SECRET-KEY-999', projectId: 'p', base: 'https://example.test/api', fetchImpl });
    await expect(client.listBranches()).rejects.toThrow(/HTTP 403/);
    await client.listBranches().catch((e) => expect(String(e)).not.toContain('SECRET-KEY-999'));
  });
});

// T4: a fake Neon HTTP server (node:http on port 0). Branches are paged two per page.
function startFakeNeon(initial, { limit = 10, deleteScript = {} } = {}) {
  let state = initial.map((b) => ({ ...b }));
  const deleteLog = [];
  const server = createServer((req, res) => {
    const u = new URL(req.url, 'http://fake');
    const path = u.pathname.replace(/^\/api\/v2\/projects\/[^/]+/, '');
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };
    if (req.method === 'GET' && path === '') return send(200, { project: { owner: { branches_limit: limit } } });
    if (req.method === 'GET' && path === '/branches') {
      const second = u.searchParams.get('cursor') !== null;
      const slice = second ? state.slice(2) : state.slice(0, 2);
      return send(200, { branches: slice, pagination: second ? {} : { next: 'page2' } });
    }
    const m = path.match(/^\/branches\/(.+)$/);
    if (req.method === 'DELETE' && m) {
      const id = m[1];
      deleteLog.push(id);
      const script = deleteScript[id] ?? [];
      const status = script.length ? script.shift() : 200;
      if (status === 200 || status === 204 || status === 404) state = state.filter((b) => b.id !== id);
      if (status === 204) return send(204);
      if (status === 200) return send(200, {});
      if (status === 404) return send(404, {});
      return send(status, {});
    }
    return send(404, {});
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        base: `http://127.0.0.1:${port}/api/v2`,
        deleteLog,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

describe('T4: apply --auto against a fake HTTP Neon server', () => {
  const merged = [
    { id: 'a', name: 'preview/claude/done-a', created_at: OLD },
    { id: 'b', name: 'preview/claude/done-b', created_at: OLD },
    { id: 'k', name: 'preview/claude/keep', created_at: OLD },
  ];
  const gh = ghState({
    mergedPrs: [
      { head: 'claude/done-a', merged_at: '2026-11-06T00:00:00Z' },
      { head: 'claude/done-b', merged_at: '2026-11-06T00:00:00Z' },
    ],
    openPrHeads: ['claude/keep'],
  });

  it('a second run finds nothing to do', async () => {
    const fake = await startFakeNeon([DEFAULT, ...merged]);
    try {
      const client = makeNeonClient({ apiKey: 'k', projectId: 'p', base: fake.base, sleep: async () => {} });
      const readJson = async () => gh;
      const first = [];
      await run({ argv: ['apply', '--auto', '--grace-hours=24', '--github=x'], env: {}, client, readJson, now: NOW, log: (l) => first.push(l) });
      expect(fake.deleteLog.sort()).toEqual(['a', 'b']);
      expect(first).toContain('after: 2/10');

      const second = [];
      const out = await run({ argv: ['apply', '--auto', '--grace-hours=24', '--github=x'], env: {}, client, readJson, now: NOW, log: (l) => second.push(l) });
      expect(out.candidates).toEqual([]);
      expect(fake.deleteLog).toHaveLength(2);
      expect(second).toContain('after: 2/10');
    } finally {
      await fake.close();
    }
  });

  it('a 404 on DELETE logs already deleted and exits 0', async () => {
    const fake = await startFakeNeon([DEFAULT, merged[0]], { deleteScript: { a: [404] } });
    try {
      const client = makeNeonClient({ apiKey: 'k', projectId: 'p', base: fake.base, sleep: async () => {} });
      const lines = [];
      await run({ argv: ['apply', '--auto', '--grace-hours=24', '--github=x'], env: {}, client, readJson: async () => gh, now: NOW, log: (l) => lines.push(l) });
      expect(lines.some((l) => l.startsWith('already deleted preview/claude/done-a'))).toBe(true);
    } finally {
      await fake.close();
    }
  });

  it('a 423 then 200 is retried and the branch is deleted', async () => {
    const fake = await startFakeNeon([DEFAULT, merged[0]], { deleteScript: { a: [423, 200] } });
    try {
      const sleeps = [];
      const client = makeNeonClient({ apiKey: 'k', projectId: 'p', base: fake.base, sleep: async (ms) => sleeps.push(ms) });
      const lines = [];
      await run({ argv: ['apply', '--auto', '--grace-hours=24', '--github=x'], env: {}, client, readJson: async () => gh, now: NOW, log: (l) => lines.push(l) });
      expect(fake.deleteLog).toEqual(['a', 'a']);
      expect(sleeps).toEqual([2000]);
      expect(lines).toContain('DELETED preview/claude/done-a (a)');
    } finally {
      await fake.close();
    }
  });
});

describe('T5: main and the default are never deleted, through the real client', () => {
  it('main is never a candidate, and deleting it is refused', async () => {
    const branches = [
      MAIN,
      { id: 'pm', name: 'preview/main', primary: true, created_at: OLD },
      { id: 'd', name: 'preview/claude/done', created_at: OLD },
    ];
    const seen = [];
    const fetchImpl = async (url, init) => {
      const u = new URL(url);
      const path = u.pathname.replace(/^\/api\/v2\/projects\/[^/]+/, '');
      seen.push(`${init.method} ${path}`);
      if (path === '') return { ok: true, status: 200, json: async () => ({ project: { owner: { branches_limit: 10 } } }) };
      if (path === '/branches') return { ok: true, status: 200, json: async () => ({ branches }) };
      return { ok: true, status: 204, json: async () => null };
    };
    const client = makeNeonClient({ apiKey: 'k', projectId: 'p', base: 'https://example.test/api/v2', fetchImpl });
    const readJson = async () => ghState({ mergedPrs: [{ head: 'claude/done', merged_at: '2026-11-06T00:00:00Z' }] });
    const lines = [];
    const out = await run({ argv: ['plan', '--github=x'], env: {}, client, readJson, now: NOW, log: (l) => lines.push(l) });
    expect(out.candidates.map((c) => c.id)).toEqual(['d']);
    expect(lines.join('\n')).not.toMatch(/CANDIDATE (main|preview\/main)/);
    await expect(client.deleteBranch('br-spring-glade-bbc3zlza')).rejects.toThrow(/protected|not in the last listing/);
    await expect(client.deleteBranch('pm')).rejects.toThrow(/protected/);
    expect(seen.some((s) => s.startsWith('DELETE'))).toBe(false);
  });
});

describe('T9: the workflow', () => {
  const text = readFileSync('.github/workflows/neon-preview-cleanup.yml', 'utf8');
  const lines = text.split('\n');

  it('checks out the default branch ref and never uses pull_request_target', () => {
    expect(text).toContain('ref: ${{ github.event.repository.default_branch }}');
    expect(text).not.toContain('pull_request_target');
  });

  it('uses github.head_ref only under an env: key', () => {
    const uses = lines.filter((l) => l.includes('github.head_ref'));
    expect(uses.length).toBeGreaterThan(0);
    for (const l of uses) expect(l).toMatch(/^\s*HEAD_REF: \$\{\{ github\.head_ref \}\}\s*$/);
  });

  it('pins every action to a 40-hex commit', () => {
    const uses = lines.filter((l) => /^\s*-?\s*uses:/.test(l));
    expect(uses.length).toBeGreaterThan(0);
    for (const l of uses) expect(l).toMatch(/@[0-9a-f]{40}\b/);
  });
});
