import { describe, it, expect, vi } from 'vitest';
import { selectCandidates, run, makeNeonClient, STABLE_PREVIEW, MAX_DELETES } from '../../scripts/neon-preview-cleanup.mjs';

const NOW = Date.parse('2026-11-08T12:00:00Z');
const OLD = '2026-10-01T00:00:00Z';
const RECENT = '2026-11-08T11:00:00Z';
const DEFAULT = { id: 'br-default', name: 'production', default: true, created_at: OLD };

function base(overrides = {}) {
  return {
    neonBranches: [DEFAULT],
    openPrHeads: [],
    mergedPrs: [],
    gitBranches: ['main'],
    now: NOW,
    ...overrides,
  };
}

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

  it('never selects a branch that has child branches', () => {
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

describe('selectCandidates: cap', () => {
  it('aborts when candidates exceed the cap', () => {
    const neonBranches = [DEFAULT];
    for (let i = 0; i < MAX_DELETES + 1; i += 1) {
      neonBranches.push({ id: `c${i}`, name: `preview/claude/old-${i}`, created_at: OLD });
    }
    expect(() => selectCandidates(base({ neonBranches }))).toThrow(/exceeds the cap/);
  });
});

describe('run: confirmation and deletes', () => {
  function client(neonBranches) {
    return {
      listBranches: vi.fn(async () => neonBranches),
      deleteBranch: vi.fn(async () => null),
    };
  }
  const github = {
    openPrHeads: [],
    mergedPrs: [{ head: 'claude/done', merged_at: '2026-11-06T00:00:00Z' }],
    gitBranches: ['main'],
  };
  const neonBranches = [DEFAULT, { id: 'm', name: 'preview/claude/done', created_at: OLD }];
  const readJson = async () => github;

  it('dry run deletes nothing', async () => {
    const c = client(neonBranches);
    const out = await run({ argv: ['--dry-run', '--github=x'], env: {}, client: c, readJson, now: NOW, log: () => {} });
    expect(out.candidates).toHaveLength(1);
    expect(c.deleteBranch).not.toHaveBeenCalled();
  });

  it('apply with the wrong confirm count deletes nothing', async () => {
    const c = client(neonBranches);
    await expect(
      run({ argv: ['--apply', '--confirm-count=5', '--github=x'], env: {}, client: c, readJson, now: NOW, log: () => {} }),
    ).rejects.toThrow(/confirm-count must equal 1/);
    expect(c.deleteBranch).not.toHaveBeenCalled();
  });

  it('apply with the exact confirm count deletes only the candidates', async () => {
    const c = client(neonBranches);
    await run({ argv: ['--apply', '--confirm-count=1', '--github=x'], env: {}, client: c, readJson, now: NOW, log: () => {} });
    expect(c.deleteBranch).toHaveBeenCalledTimes(1);
    expect(c.deleteBranch).toHaveBeenCalledWith('m');
  });

  it('never prints the API key', async () => {
    const lines = [];
    const c = client(neonBranches);
    await run({ argv: ['--dry-run', '--github=x'], env: { NEON_API_KEY: 'SECRET-KEY-123' }, client: c, readJson, now: NOW, log: (l) => lines.push(l) });
    expect(lines.join('\n')).not.toContain('SECRET-KEY-123');
  });
});

describe('selectCandidates: duplicate merged heads', () => {
  it('uses the most recent merge for a branch, so an old PR cannot bypass the grace period', () => {
    const neonBranches = [DEFAULT, { id: 'd', name: 'preview/claude/reused', created_at: OLD }];
    const mergedPrs = [
      { head: 'claude/reused', merged_at: '2026-11-08T11:00:00Z' }, // one hour ago: inside grace
      { head: 'claude/reused', merged_at: '2026-10-01T00:00:00Z' }, // old
    ];
    const { candidates } = selectCandidates(base({ neonBranches, mergedPrs, graceHours: 24 }));
    expect(candidates).toEqual([]);
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
