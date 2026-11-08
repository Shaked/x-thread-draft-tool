import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as gate from '../../scripts/codex-gate.mjs';

// Vitest runs from the repo root (npm scripts), so fixtures resolve from there.
const fixture = (name) => readFileSync(join(process.cwd(), 'tests/unit/fixtures/codex', name), 'utf8');
const threadsFixture = () => JSON.parse(fixture('threads.json')).threads;
const commentsFixture = () => JSON.parse(fixture('comments.json')).comments;

const CLEAN_SHA = 'ae5c5bd9d18c059af64ac77e3cb6d25e92d98709';
const FINDINGS_SHA = '528f5bae9a858200c99d1d1735581bc8fbd83764';
const RUNNING_SHA = '3f1c0a9e2b7d4c6a8e5f1d0b9a7c6e4d2f1a0b9c';
const HEAD = CLEAN_SHA;
const PR = 25;

const codexComment = (body) => ({ user: { login: 'chatgpt-codex-connector[bot]' }, body });
const actionsComment = (body) => ({ user: { login: 'github-actions[bot]' }, body });
const humanComment = (body) => ({ user: { login: 'Shaked' }, body });

describe('parseSummaryState', () => {
  it('reads the state from a raw-brace marker (PR #24 shape)', () => {
    expect(gate.parseSummaryState(fixture('clean-state-comment.md'))).toEqual({
      commitSha: CLEAN_SHA,
      status: 'completed',
      hasUnresolvedFindings: false,
    });
  });

  it('reads the state from an HTML-escaped marker (&#123; &#125;) and reports running', () => {
    expect(gate.parseSummaryState(fixture('running-state-comment-escaped.md'))).toEqual({
      commitSha: RUNNING_SHA,
      status: 'running',
      hasUnresolvedFindings: false,
    });
  });

  it('returns null when the state marker is missing', () => {
    expect(gate.parseSummaryState('<!-- codex-pull-request-review-summary -->\nno state')).toBeNull();
  });

  it('returns null for malformed JSON', () => {
    expect(gate.parseSummaryState('<!-- codex-review-state:v1 {"code_review": -->')).toBeNull();
  });

  it('returns null when code_review is absent', () => {
    expect(gate.parseSummaryState('<!-- codex-review-state:v1 {"security_review":{}} -->')).toBeNull();
  });
});

describe('findLatestSummary', () => {
  it('ignores a completed-looking summary pasted by a person', () => {
    const comments = commentsFixture().filter((c) => c.user.login === 'Shaked');
    expect(gate.findLatestSummary(comments)).toBeNull();
  });

  it('uses the newest Codex summary and skips the human one', () => {
    expect(gate.findLatestSummary(commentsFixture())).toEqual({
      commitSha: FINDINGS_SHA,
      status: 'completed',
      hasUnresolvedFindings: true,
    });
  });

  it('returns null when Codex has not commented', () => {
    expect(gate.findLatestSummary([humanComment('hello')])).toBeNull();
  });
});

describe('evaluateReview', () => {
  it('is not ready when there is no summary', () => {
    expect(gate.evaluateReview({ summary: null, headSha: HEAD })).toEqual({ ready: false, reason: 'missing' });
  });

  it('is not ready when the summary is for an older commit', () => {
    const summary = gate.parseSummaryState(fixture('unresolved-state-comment.md'));
    expect(gate.evaluateReview({ summary, headSha: HEAD })).toEqual({
      ready: false,
      reason: 'stale',
      reviewedSha: FINDINGS_SHA,
    });
  });

  it('is not ready while Codex is running on this commit', () => {
    const summary = gate.parseSummaryState(fixture('running-state-comment-escaped.md'));
    expect(gate.evaluateReview({ summary, headSha: RUNNING_SHA })).toEqual({
      ready: false,
      reason: 'not-completed',
    });
  });

  it('is ready when completed on this commit', () => {
    const summary = gate.parseSummaryState(fixture('clean-state-comment.md'));
    expect(gate.evaluateReview({ summary, headSha: HEAD })).toEqual({ ready: true, reason: 'completed' });
  });
});

describe('severity and titles', () => {
  it.each(['P0', 'P1', 'P2', 'P3'])('reads the %s badge', (level) => {
    const body = `**<sub><sub>![${level} Badge](https://img.shields.io/badge/${level}-x)</sub></sub>  Title**`;
    expect(gate.severityOf(body)).toBe(level);
  });

  it('returns null when there is no badge', () => {
    expect(gate.severityOf('plain text with no badge')).toBeNull();
  });

  it('extracts the title from the P2 fixture', () => {
    expect(gate.titleOf(fixture('finding-p2.md'))).toBe(
      'Align preview smoke guidance with the actual workflow',
    );
  });

  it('extracts the title from the P1 fixture', () => {
    expect(gate.titleOf(fixture('finding-p1.md'))).toBe(
      'Build the search SQL with parameters, not string concatenation',
    );
  });

  it('recognises the finding marker on a verbatim Codex finding', () => {
    expect(
      gate.isFindingComment({ author: { login: 'chatgpt-codex-connector' }, body: fixture('finding-p2.md') }),
    ).toBe(true);
  });
});

describe('unresolvedFindings', () => {
  it('keeps only unresolved threads whose first comment is a Codex finding', () => {
    const findings = gate.unresolvedFindings(threadsFixture());
    expect(findings).toEqual([
      {
        severity: 'P1',
        title: 'Build the search SQL with parameters, not string concatenation',
        path: 'api/search.js',
        line: 42,
        url: 'https://github.com/Shaked/x-thread-draft-tool/pull/99#discussion_r1',
      },
      {
        severity: 'P2',
        title: 'Rename the helper for clarity',
        path: 'src/format.js',
        line: 13,
        url: 'https://github.com/Shaked/x-thread-draft-tool/pull/99#discussion_r3',
      },
    ]);
  });

  it('drops a resolved P0 thread (a person resolved it)', () => {
    const titles = gate.unresolvedFindings(threadsFixture()).map((f) => f.title);
    expect(titles).not.toContain('Token is logged on every request');
  });
});

describe('classifyFindings and check output', () => {
  const finding = (severity) => ({ severity, title: 't', path: 'a.js', line: 1, url: null });

  it('fails on P0 or P1', () => {
    expect(gate.classifyFindings([finding('P0')]).conclusion).toBe('failure');
    expect(gate.classifyFindings([finding('P1')]).conclusion).toBe('failure');
  });

  it('passes with only P2 and P3, which are notes', () => {
    const result = gate.classifyFindings([finding('P2'), finding('P3')]);
    expect(result.conclusion).toBe('success');
    expect(result.notes).toHaveLength(2);
  });

  it('fails closed on a finding with no readable severity', () => {
    expect(gate.classifyFindings([finding(null)]).conclusion).toBe('failure');
  });

  it('passes with no findings', () => {
    expect(gate.classifyFindings([]).conclusion).toBe('success');
  });

  it('lists each blocking finding as severity, path:line, title and link', () => {
    const check = gate.completedCheck({
      findings: [{ severity: 'P1', title: 'SQL built from input', path: 'api/search.js', line: 42, url: 'https://x/1' }],
    });
    expect(check.status).toBe('completed');
    expect(check.conclusion).toBe('failure');
    expect(check.output.title).toBe('1 blocking finding(s)');
    expect(check.output.summary).toContain('- P1 `api/search.js:42` SQL built from input ([link](https://x/1))');
  });

  it('reports a clean run as success', () => {
    const check = gate.completedCheck({ findings: [] });
    expect(check.conclusion).toBe('success');
    expect(check.output.summary).toContain('no unresolved findings');
  });
});

describe('waitingCheck', () => {
  it('is in progress and names the short SHA and the reason', () => {
    const check = gate.waitingCheck({
      headSha: HEAD,
      evaluation: { ready: false, reason: 'missing' },
      requestEnabled: false,
    });
    expect(check.status).toBe('in_progress');
    expect(check.output.summary).toContain(`Waiting for Codex on ${CLEAN_SHA.slice(0, 7)}.`);
    expect(check.output.summary).toContain('No Codex summary');
  });

  it('names the older commit Codex reviewed when stale', () => {
    const check = gate.waitingCheck({
      headSha: HEAD,
      evaluation: { ready: false, reason: 'stale', reviewedSha: FINDINGS_SHA },
      requestEnabled: true,
    });
    expect(check.output.summary).toContain('Codex last reviewed 528f5ba');
  });
});

describe('review request', () => {
  it.each([
    ['1', true],
    ['0', false],
    ['', false],
    ['true', false],
    [undefined, false],
  ])('CODEX_REVIEW_COMMENT=%p enables the request: %s', (value, expected) => {
    expect(gate.reviewRequestEnabled(value)).toBe(expected);
  });

  it('does nothing when disabled, even if the summary is missing', () => {
    expect(
      gate.shouldRequestReview({
        enabled: false,
        evaluation: { ready: false, reason: 'missing' },
        comments: [],
        headSha: HEAD,
      }),
    ).toBe(false);
  });

  it('requests when enabled and Codex has no summary yet', () => {
    expect(
      gate.shouldRequestReview({
        enabled: true,
        evaluation: { ready: false, reason: 'missing' },
        comments: [],
        headSha: HEAD,
      }),
    ).toBe(true);
  });

  it('requests again for a new head when the last request named an older SHA', () => {
    const comments = [actionsComment(gate.requestBody(FINDINGS_SHA))];
    expect(
      gate.shouldRequestReview({
        enabled: true,
        evaluation: { ready: false, reason: 'stale', reviewedSha: FINDINGS_SHA },
        comments,
        headSha: HEAD,
      }),
    ).toBe(true);
  });

  it('does not request twice for the same head SHA', () => {
    const comments = [actionsComment(gate.requestBody(HEAD))];
    expect(
      gate.shouldRequestReview({
        enabled: true,
        evaluation: { ready: false, reason: 'stale', reviewedSha: FINDINGS_SHA },
        comments,
        headSha: HEAD,
      }),
    ).toBe(false);
  });

  it('ignores a request marker a person wrote', () => {
    const comments = [humanComment(gate.requestBody(HEAD))];
    expect(
      gate.shouldRequestReview({
        enabled: true,
        evaluation: { ready: false, reason: 'missing' },
        comments,
        headSha: HEAD,
      }),
    ).toBe(true);
  });

  it('does not request while Codex is running on this commit', () => {
    expect(
      gate.shouldRequestReview({
        enabled: true,
        evaluation: { ready: false, reason: 'not-completed' },
        comments: [],
        headSha: HEAD,
      }),
    ).toBe(false);
  });

  it('the comment body names the review command and carries the SHA marker', () => {
    const body = gate.requestBody(HEAD);
    expect(body.startsWith('@codex review')).toBe(true);
    expect(body).toContain(`sha=${HEAD}`);
  });
});

describe('pull request helpers', () => {
  it('detects a fork when the head repo differs from the base repo', () => {
    expect(gate.isForkPr({ head: { repo: { full_name: 'x/fork' } }, base: { repo: { full_name: 'o/r' } } })).toBe(true);
    expect(gate.isForkPr({ head: { repo: null }, base: { repo: { full_name: 'o/r' } } })).toBe(true);
    expect(gate.isForkPr({ head: { repo: { full_name: 'o/r' } }, base: { repo: { full_name: 'o/r' } } })).toBe(false);
  });

  it('reads the PR number from pull_request and issue_comment events only', () => {
    expect(gate.prNumberFromEvent({ pull_request: { number: 7 } })).toBe(7);
    expect(gate.prNumberFromEvent({ issue: { number: 8, pull_request: {} } })).toBe(8);
    expect(gate.prNumberFromEvent({ issue: { number: 9 } })).toBeNull();
  });
});

function fakeGh(overrides = {}) {
  return {
    getPull: vi.fn(async () => ({
      head: { sha: HEAD, repo: { full_name: 'o/r' } },
      base: { repo: { full_name: 'o/r' } },
    })),
    listComments: vi.fn(async () => []),
    createComment: vi.fn(async () => {}),
    listReviewThreads: vi.fn(async () => []),
    findOrCreateCheckRun: vi.fn(async () => 42),
    updateCheckRun: vi.fn(async () => {}),
    ...overrides,
  };
}

const event = { pull_request: { number: PR } };

describe('runRequest', () => {
  it('does not touch GitHub when the variable is not 1', async () => {
    const gh = fakeGh();
    const result = await gate.runRequest({ env: { CODEX_REVIEW_COMMENT: '0' }, event, gh });
    expect(result.posted).toBe(false);
    expect(gh.getPull).not.toHaveBeenCalled();
  });

  it('posts the review request once for a new head SHA', async () => {
    const gh = fakeGh({ listComments: vi.fn(async () => [codexComment(fixture('unresolved-state-comment.md'))]) });
    const result = await gate.runRequest({ env: { CODEX_REVIEW_COMMENT: '1' }, event, gh });
    expect(result).toEqual({ posted: true, headSha: HEAD });
    expect(gh.createComment).toHaveBeenCalledWith(PR, gate.requestBody(HEAD));
  });

  it('refuses to run on a fork PR', async () => {
    const gh = fakeGh({
      getPull: vi.fn(async () => ({ head: { sha: HEAD, repo: { full_name: 'x/fork' } }, base: { repo: { full_name: 'o/r' } } })),
    });
    await expect(gate.runRequest({ env: { CODEX_REVIEW_COMMENT: '1' }, event, gh })).rejects.toThrow(/read-only token/);
    expect(gh.createComment).not.toHaveBeenCalled();
  });
});

describe('runGate', () => {
  it('leaves the check in progress while Codex has not reviewed the head', async () => {
    const gh = fakeGh();
    const result = await gate.runGate({ env: { CODEX_REVIEW_COMMENT: '0' }, event, gh });
    expect(result).toEqual({ state: 'waiting', reason: 'missing' });
    expect(gh.updateCheckRun).toHaveBeenCalledWith(42, expect.objectContaining({ status: 'in_progress' }));
  });

  it('fails the check on an unresolved P1 thread', async () => {
    const gh = fakeGh({
      listComments: vi.fn(async () => [codexComment(fixture('clean-state-comment.md'))]),
      listReviewThreads: vi.fn(async () => threadsFixture()),
    });
    const result = await gate.runGate({ env: {}, event, gh });
    expect(result).toEqual({ state: 'failure', blocking: 1 });
    expect(gh.updateCheckRun).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ status: 'completed', conclusion: 'failure' }),
    );
  });

  it('succeeds when only P2 notes remain', async () => {
    const onlyNotes = threadsFixture().filter((t) => !t.comments.nodes[0].body.includes('P1 Badge'));
    const gh = fakeGh({
      listComments: vi.fn(async () => [codexComment(fixture('clean-state-comment.md'))]),
      listReviewThreads: vi.fn(async () => onlyNotes),
    });
    const result = await gate.runGate({ env: {}, event, gh });
    expect(result).toEqual({ state: 'success', blocking: 0 });
  });

  it('refuses to run on a fork PR before touching the check run', async () => {
    const gh = fakeGh({
      getPull: vi.fn(async () => ({ head: { sha: HEAD, repo: null }, base: { repo: { full_name: 'o/r' } } })),
    });
    await expect(gate.runGate({ env: {}, event, gh })).rejects.toThrow(/Failing closed/);
    expect(gh.findOrCreateCheckRun).not.toHaveBeenCalled();
  });
});

describe('createGitHub', () => {
  it('reuses the newest existing "Codex review" check run for the SHA', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({ check_runs: [{ id: 11 }, { id: 90 }, { id: 35 }] }),
    }));
    const gh = gate.createGitHub({ token: 't', repo: 'o/r', fetchImpl });
    expect(await gh.findOrCreateCheckRun(HEAD)).toBe(90);
    const [url] = fetchImpl.mock.calls[0];
    expect(url).toContain(`/repos/o/r/commits/${HEAD}/check-runs?check_name=Codex%20review`);
  });

  it('follows Link pagination when listing comments', async () => {
    const pages = [
      { body: [{ user: { login: 'Shaked' }, body: 'a' }], link: '<https://api.github.com/next-page>; rel="next"' },
      { body: [{ user: { login: 'Shaked' }, body: 'b' }], link: null },
    ];
    const fetchImpl = vi.fn(async () => {
      const page = pages.shift();
      return {
        ok: true,
        status: 200,
        headers: new Headers(page.link ? { link: page.link } : {}),
        json: async () => page.body,
      };
    });
    const gh = gate.createGitHub({ token: 't', repo: 'o/r', fetchImpl });
    const comments = await gh.listComments(PR);
    expect(comments.map((c) => c.body)).toEqual(['a', 'b']);
  });
});
