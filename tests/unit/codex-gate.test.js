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

describe('notReviewedCheck', () => {
  it('fails, names the short SHA and tells a person to comment @codex review', () => {
    const check = gate.notReviewedCheck({ headSha: HEAD, evaluation: { ready: false, reason: 'missing' } });
    expect(check.status).toBe('completed');
    expect(check.conclusion).toBe('failure');
    expect(check.output.title).toBe(`Codex has not reviewed ${CLEAN_SHA.slice(0, 7)}`);
    expect(check.output.summary).toContain('`@codex review`');
  });

  it('names the older commit Codex reviewed when stale', () => {
    const check = gate.notReviewedCheck({
      headSha: HEAD,
      evaluation: { ready: false, reason: 'stale', reviewedSha: FINDINGS_SHA },
    });
    expect(check.conclusion).toBe('failure');
    expect(check.output.summary).toContain('Codex last reviewed 528f5ba');
  });

  it('while Codex is running, fails and says to wait instead of asking for a new request', () => {
    const check = gate.notReviewedCheck({ headSha: HEAD, evaluation: { ready: false, reason: 'not-completed' } });
    expect(check.conclusion).toBe('failure');
    expect(check.output.summary).toContain('Wait for Codex');
    expect(check.output.summary).not.toContain('`@codex review`');
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
    listReviewThreads: vi.fn(async () => []),
    findOrCreateCheckRun: vi.fn(async () => 42),
    updateCheckRun: vi.fn(async () => {}),
    ...overrides,
  };
}

const event = { pull_request: { number: PR } };

describe('runGate', () => {
  it('a reused check is put back in progress before review state is read, so a read error cannot leave a success', async () => {
    const gh = fakeGh({
      listComments: vi.fn(async () => {
        throw new Error('GitHub GET comments failed: HTTP 500');
      }),
    });
    await expect(gate.runGate({ event, gh })).rejects.toThrow(/HTTP 500/);
    const calls = gh.updateCheckRun.mock.calls;
    expect(calls[0][1]).toEqual(expect.objectContaining({ status: 'in_progress' }));
    expect(calls.some(([, fields]) => fields.conclusion === 'success')).toBe(false);
  });

  it('fails the check and posts nothing while Codex has not reviewed the head', async () => {
    const gh = fakeGh();
    const result = await gate.runGate({ event, gh });
    expect(result).toEqual({ state: 'not-reviewed', reason: 'missing' });
    expect(gh.updateCheckRun).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ status: 'completed', conclusion: 'failure' }),
    );
    expect(gh.createComment).toBeUndefined();
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

// Comment-only Codex findings (Opus decision on #58, after the live check on #67).
const SHA_67 = 'a28ac7b82d256f90c68eb43a8527e9f20accbdb5';
const SHA_OLD = '34dd504e4d109ae96bc291ba2d82c7fb11ba6774';
// The P1 that Codex posted as a plain PR comment on #67 (text as posted).
const FINDING_67 = `## Review finding

- **[P1] Parameterize the draft-title query.** The \`t\` query parameter is interpolated directly into SQL, allowing crafted input such as \`' OR 1=1 --\` to alter the query. [server/routes/throwaway-sql.jsL4-L7](https://github.com/Shaked/x-thread-draft-tool/blob/${SHA_67}/server/routes/throwaway-sql.js#L4-L7)

No code changes were made, so no commit or follow-up pull request was created.`;
const findingComment = (id, body) => ({ id, user: { login: 'chatgpt-codex-connector[bot]' }, body, html_url: `https://example.test/c/${id}` });
const humanCommentFx = (id, body) => ({ id, user: { login: 'Shaked' }, body });

describe('codexCommentFindings: comment-only findings', () => {
  it('blocks on the P1 comment posted for the current head (the #67 case)', () => {
    const findings = gate.codexCommentFindings({ comments: [findingComment(1, FINDING_67)], headSha: SHA_67 });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('P1');
    expect(gate.classifyFindings(findings).conclusion).toBe('failure');
  });

  it('ignores a finding comment that names an older head', () => {
    const comment = findingComment(2, FINDING_67.replaceAll(SHA_67, SHA_OLD));
    expect(gate.codexCommentFindings({ comments: [comment], headSha: SHA_67 })).toEqual([]);
  });

  it('a person clears one comment only with the exact marker naming its id', () => {
    const finding = findingComment(7, FINDING_67);
    const cleared = gate.codexCommentFindings({
      comments: [finding, humanCommentFx(8, `Fixed in a new commit.\ncodex-finding-handled: 7`)],
      headSha: SHA_67,
    });
    expect(cleared).toEqual([]);
    const otherId = gate.codexCommentFindings({
      comments: [finding, humanCommentFx(9, 'codex-finding-handled: 70')],
      headSha: SHA_67,
    });
    expect(otherId).toHaveLength(1);
  });

  it('Codex cannot clear its own finding with the marker', () => {
    const forged = findingComment(12, 'codex-finding-handled: 7');
    const findings = gate.codexCommentFindings({ comments: [findingComment(7, FINDING_67), forged], headSha: SHA_67 });
    expect(findings).toHaveLength(1);
  });

  it('a bullet with no readable badge blocks (fail closed)', () => {
    const body = '## Review finding\n\n- Something was found but no severity was printed.';
    const findings = gate.codexCommentFindings({ comments: [findingComment(3, body)], headSha: SHA_67 });
    expect(findings[0].severity).toBeNull();
    expect(gate.classifyFindings(findings).conclusion).toBe('failure');
  });

  it('a P2 comment is a note, not a block', () => {
    const body = FINDING_67.replace('[P1]', '[P2]');
    const findings = gate.codexCommentFindings({ comments: [findingComment(4, body)], headSha: SHA_67 });
    expect(gate.classifyFindings(findings).conclusion).toBe('success');
  });
});

describe('runGate: comment findings and the summary flag', () => {
  it('fails on the #67 P1 comment even when the summary is completed with no flag', async () => {
    const summary = findingComment(
      20,
      `<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 {"code_review":{"commit_sha":"${SHA_67}","status":"completed","has_unresolved_findings":false}} -->`,
    );
    const gh = fakeGh({
      getPull: vi.fn(async () => ({ head: { sha: SHA_67, repo: { full_name: 'o/r' } }, base: { repo: { full_name: 'o/r' } } })),
      listComments: vi.fn(async () => [findingComment(1, FINDING_67), summary]),
    });
    const result = await gate.runGate({ event, gh });
    expect(result.state).toBe('failure');
    expect(gh.updateCheckRun).toHaveBeenLastCalledWith(42, expect.objectContaining({ conclusion: 'failure' }));
  });

  it('fails closed when the summary says findings exist but none is visible', async () => {
    const summary = findingComment(
      21,
      `<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 {"code_review":{"commit_sha":"${SHA_67}","status":"completed","has_unresolved_findings":true}} -->`,
    );
    const gh = fakeGh({
      getPull: vi.fn(async () => ({ head: { sha: SHA_67, repo: { full_name: 'o/r' } }, base: { repo: { full_name: 'o/r' } } })),
      listComments: vi.fn(async () => [summary]),
    });
    const result = await gate.runGate({ event, gh });
    expect(result.state).toBe('failure');
  });
});

describe('runGate: a handled finding is visible, so it does not trip the fallback', () => {
  it('passes when the only Codex finding is cleared with the marker and the summary flag stays true', async () => {
    const summary = findingComment(
      30,
      `<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 {"code_review":{"commit_sha":"${SHA_67}","status":"completed","has_unresolved_findings":true}} -->`,
    );
    const handled = humanCommentFx(31, 'Fixed in a new commit.\ncodex-finding-handled: 1');
    const gh = fakeGh({
      getPull: vi.fn(async () => ({ head: { sha: SHA_67, repo: { full_name: 'o/r' } }, base: { repo: { full_name: 'o/r' } } })),
      listComments: vi.fn(async () => [findingComment(1, FINDING_67), summary, handled]),
    });
    const result = await gate.runGate({ event, gh });
    expect(result.state).toBe('success');
  });
});

