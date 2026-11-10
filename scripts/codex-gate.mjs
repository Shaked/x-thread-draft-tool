// Codex gate: turns Codex review findings into the required check run "Codex review".
//
// Runs from a checkout of main (never of PR code):  node scripts/codex-gate.mjs
//
// Codex reviews when a PR opens and when a connected person comments "@codex review". It does not
// review pushes, and it ignores comments from github-actions[bot]. So this gate posts nothing and
// holds no secret: when Codex has not completed a review of the current head, the check FAILS and
// tells the person to comment "@codex review". Switching later is small:
//   - Codex setting "review every push" on: nothing here changes, the failure just stops happening.
//   - Gate posts the request itself: add one POST of REVIEW_REQUEST_TEXT in runGate (needs a token of
//     a Codex-connected account).
//
// Everything above the I/O layer is a pure function (unit-tested in tests/unit/codex-gate.test.js).

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const CHECK_NAME = 'Codex review';
export const CODEX_LOGINS = ['chatgpt-codex-connector[bot]', 'chatgpt-codex-connector'];
export const SUMMARY_MARKER = '<!-- codex-pull-request-review-summary -->';
export const FINDING_MARKER = '<!-- codex-code-review-finding:v1 -->';
export const REVIEW_REQUEST_TEXT = '@codex review';

const STATE_PATTERN = /<!-- codex-review-state:v1 (.*?) -->/s;
const SEVERITY_PATTERN = /!\[P([0-3]) Badge\]/;
const API = 'https://api.github.com';

// ---------- pure functions ----------

export function isCodexLogin(login) {
  return CODEX_LOGINS.includes(login);
}

// Codex writes the state JSON with HTML-escaped braces. Accept raw braces too (PR #25 has them).
export function unescapeMarkerJson(text) {
  return text.replaceAll('&#123;', '{').replaceAll('&#125;', '}');
}

export function parseSummaryState(body) {
  const match = STATE_PATTERN.exec(body ?? '');
  if (!match) return null;
  let parsed;
  try {
    parsed = JSON.parse(unescapeMarkerJson(match[1]));
  } catch {
    return null;
  }
  const review = parsed?.code_review;
  if (!review || typeof review !== 'object') return null;
  return {
    commitSha: typeof review.commit_sha === 'string' ? review.commit_sha : null,
    status: typeof review.status === 'string' ? review.status : null,
    hasUnresolvedFindings: review.has_unresolved_findings === true,
  };
}

// Only the Codex bot counts. A person could paste the marker to fake a completed review.
// The newest Codex summary comment wins.
export function findLatestSummary(comments) {
  const summaries = comments.filter(
    (c) => isCodexLogin(c.user?.login) && (c.body ?? '').includes(SUMMARY_MARKER),
  );
  const latest = summaries.at(-1);
  return latest ? parseSummaryState(latest.body) : null;
}

export function evaluateReview({ summary, headSha }) {
  if (!summary) return { ready: false, reason: 'missing' };
  if (summary.commitSha !== headSha) {
    return { ready: false, reason: 'stale', reviewedSha: summary.commitSha };
  }
  if (summary.status !== 'completed') return { ready: false, reason: 'not-completed' };
  return { ready: true, reason: 'completed' };
}

export function severityOf(body) {
  const match = SEVERITY_PATTERN.exec(body ?? '');
  return match ? `P${match[1]}` : null;
}

export function titleOf(body) {
  const firstLine = (body ?? '').split('\n')[0] ?? '';
  const title = firstLine
    .replace(/!\[P[0-3] Badge\]\([^)]*\)/g, '')
    .replace(/<\/?sub>/g, '')
    .replace(/\*\*/g, '')
    .trim();
  return title || 'Untitled finding';
}

export function isFindingComment(comment) {
  return isCodexLogin(comment?.author?.login) && (comment.body ?? '').includes(FINDING_MARKER);
}

// Input: GraphQL reviewThreads nodes. A thread counts when its first comment is a Codex finding
// and the thread is unresolved. A thread a person resolved counts as handled.
export function unresolvedFindings(threads) {
  const findings = [];
  for (const thread of threads) {
    if (thread.isResolved) continue;
    const first = thread.comments?.nodes?.[0];
    if (!first || !isFindingComment(first)) continue;
    findings.push({
      severity: severityOf(first.body),
      title: titleOf(first.body),
      path: first.path ?? 'unknown file',
      line: first.line ?? first.originalLine ?? null,
      url: first.url ?? null,
    });
  }
  return findings;
}

// P0/P1 block. A finding with no readable severity also blocks: a new badge format must not pass.
// P2/P3 are notes only.
// Codex also posts findings as plain PR comments ("## Review finding" with one bullet per finding).
// A comment counts only for the current head: its text must name the head sha, or no other sha.
// A bullet with no readable [P0-3] badge counts as blocking. A person clears one comment only with
// the exact marker "codex-finding-handled: <comment id>" in a non-Codex comment (Opus decision, #58).
export const COMMENT_FINDING_HEADING = /(^|\n)##\s+Review finding\b/;
export const HANDLED_PREFIX = 'codex-finding-handled: ';
const SHA_PATTERN = /\b[0-9a-f]{40}\b/g;

export function isCodexCommentFinding(comment) {
  return isCodexLogin(comment?.user?.login) && COMMENT_FINDING_HEADING.test(comment.body ?? '');
}

// A comment belongs to the head when it names the head sha. A comment that names only other shas is
// stale. A comment that names no sha at all is counted (fail closed).
export function belongsToHead(body, headSha) {
  const shas = (body ?? '').match(SHA_PATTERN) ?? [];
  return shas.length === 0 || shas.includes(headSha);
}

export function codexCommentFindings({ comments, headSha }) {
  const cleared = new Set();
  for (const c of comments) {
    if (isCodexLogin(c?.user?.login)) continue;
    for (const match of (c.body ?? '').matchAll(/codex-finding-handled: (\d+)/g)) cleared.add(match[1]);
  }
  const findings = [];
  for (const comment of comments) {
    if (!isCodexCommentFinding(comment)) continue;
    if (!belongsToHead(comment.body, headSha)) continue;
    if (cleared.has(String(comment.id))) continue;
    const bullets = (comment.body ?? '').split('\n').filter((line) => line.startsWith('- '));
    for (const line of bullets) {
      const badge = /\[P([0-3])\]/.exec(line);
      findings.push({
        severity: badge ? `P${badge[1]}` : null,
        title: line.replace(/\[P[0-3]\]/, '').replace(/[*`]/g, '').replace(/^-\s*/, '').trim() || 'Untitled finding',
        path: 'PR comment',
        line: null,
        url: comment.html_url ?? null,
      });
    }
    if (bullets.length === 0) {
      findings.push({ severity: null, title: 'Review finding with no readable bullet', path: 'PR comment', line: null, url: comment.html_url ?? null });
    }
  }
  return findings;
}

// Every Codex finding comment for the head, cleared or not. Used to tell "no finding is visible"
// from "a finding is visible and was handled".
export function visibleCommentFindingCount({ comments, headSha }) {
  return comments.filter((c) => isCodexCommentFinding(c) && belongsToHead(c.body, headSha)).length;
}

// Threads from earlier commits do not count for this head. A thread counts when its original commit
// is the head, or its body names the head sha. Unlike belongsToHead, a body that names no sha does
// not count here: an outdated thread with no sha in its text must not look visible (bug B3).
export function visibleThreadFindingCount(threads, headSha) {
  return threads.filter((t) => {
    const first = t.comments?.nodes?.[0];
    if (!first || !isFindingComment(first)) return false;
    const originalSha = first.originalCommit?.oid ?? null;
    return originalSha === headSha || (first.body ?? '').includes(headSha);
  }).length;
}

export function classifyFindings(findings) {
  const blocking = findings.filter(
    (f) => f.severity === null || f.severity === 'P0' || f.severity === 'P1',
  );
  const notes = findings.filter((f) => f.severity === 'P2' || f.severity === 'P3');
  return { blocking, notes, conclusion: blocking.length > 0 ? 'failure' : 'success' };
}

export function renderFindingLine(finding) {
  const location = finding.line ? `${finding.path}:${finding.line}` : finding.path;
  const link = finding.url ? ` ([link](${finding.url}))` : '';
  return `- ${finding.severity ?? 'P?'} \`${location}\` ${finding.title}${link}`;
}

export function completedCheck({ findings }) {
  const { blocking, notes, conclusion } = classifyFindings(findings);
  const lines = [];
  if (blocking.length > 0) {
    lines.push('### Blocking (P0/P1)', ...blocking.map(renderFindingLine), '');
    lines.push('Resolve each thread on the pull request to clear it. Resolving counts as handled.', '');
  }
  if (notes.length > 0) {
    lines.push('### Notes (P2/P3, not blocking)', ...notes.map(renderFindingLine), '');
  }
  if (findings.length === 0) lines.push('Codex reported no unresolved findings.');
  const title =
    conclusion === 'failure'
      ? `${blocking.length} blocking finding(s)`
      : 'No blocking findings';
  return { status: 'completed', conclusion, output: { title, summary: lines.join('\n') } };
}

const NOT_REVIEWED_REASON = {
  missing: 'Codex has not reviewed this pull request yet.',
  stale: (sha) => `Codex last reviewed ${sha?.slice(0, 7) ?? 'another commit'}, not this one.`,
  'not-completed': 'The Codex review of this commit has not finished.',
};

// Fails (not "in progress") so the required check blocks until Codex has reviewed the head.
// The check re-runs by itself when Codex edits its summary comment.
export function notReviewedCheck({ headSha, evaluation }) {
  const short = headSha.slice(0, 7);
  const reason = NOT_REVIEWED_REASON[evaluation.reason];
  const detail = typeof reason === 'function' ? reason(evaluation.reviewedSha) : reason;
  const how =
    evaluation.reason === 'not-completed'
      ? 'Wait for Codex to finish; this check updates by itself.'
      : `Comment \`${REVIEW_REQUEST_TEXT}\` on this pull request. This check updates when Codex finishes.`;
  return {
    status: 'completed',
    conclusion: 'failure',
    completed_at: new Date().toISOString(),
    output: { title: `Codex has not reviewed ${short}`, summary: `${detail} ${how}` },
  };
}

export function isForkPr(pr) {
  return pr?.head?.repo?.full_name !== pr?.base?.repo?.full_name;
}

export function prNumberFromEvent(event) {
  if (event.pull_request) return event.pull_request.number;
  if (event.issue?.pull_request) return event.issue.number;
  return null;
}

const FORK_MESSAGE =
  'Fork PRs get a read-only token, so the Codex gate cannot write its check run. Failing closed.';

// ---------- orchestration (takes an injected GitHub client) ----------

export async function runGate({ event, gh }) {
  const number = prNumberFromEvent(event);
  if (number === null) return { state: 'skipped', reason: 'not a pull request' };
  const pr = await gh.getPull(number);
  if (isForkPr(pr)) throw new Error(FORK_MESSAGE);
  const headSha = pr.head.sha;
  const checkRunId = await gh.findOrCreateCheckRun(headSha);
  // A reused check run may still hold an earlier success. Put it back in progress before reading review
  // state, so an error while reading (which throws out of runGate) cannot leave that success standing.
  await gh.updateCheckRun(checkRunId, {
    status: 'in_progress',
    output: { title: 'Checking for a Codex review', summary: 'Re-evaluating the Codex review state.' },
  });

  const comments = await gh.listComments(number);
  const summary = findLatestSummary(comments);
  const evaluation = evaluateReview({ summary, headSha });
  if (!evaluation.ready) {
    await gh.updateCheckRun(checkRunId, notReviewedCheck({ headSha, evaluation }));
    return { state: 'not-reviewed', reason: evaluation.reason };
  }

  const threads = await gh.listReviewThreads(number);
  const threadFindings = unresolvedFindings(threads);
  const commentFindings = codexCommentFindings({ comments, headSha });
  let findings = [...threadFindings, ...commentFindings];
  // Codex's summary can say it has unresolved findings that the gate cannot see at all (no finding
  // thread or comment for this head, handled or not). Fail closed then. A finding a person handled
  // is visible, so it does not trigger this fallback. Findings from older commits do not make the
  // head visible: an outdated P2 thread must not hide the fallback (bug B3).
  const visible = visibleThreadFindingCount(threads, headSha) + visibleCommentFindingCount({ comments, headSha });
  if (summary?.hasUnresolvedFindings && visible === 0) {
    findings = [{ severity: null, title: 'Codex reports unresolved findings the gate cannot see', path: 'Codex summary', line: null, url: null }];
  }
  const result = completedCheck({ findings });
  await gh.updateCheckRun(checkRunId, { ...result, completed_at: new Date().toISOString() });
  return { state: result.conclusion, blocking: classifyFindings(findings).blocking.length };
}

// ---------- GitHub I/O ----------

async function call(fetchImpl, token, method, url, body) {
  const response = await fetchImpl(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    throw new Error(`GitHub ${method} ${url.replace(API, '')} failed: HTTP ${response.status}`);
  }
  return { json: response.status === 204 ? null : await response.json(), response };
}

export function createGitHub({ token, repo, fetchImpl = fetch }) {
  const [owner, name] = repo.split('/');
  const repoPath = `/repos/${repo}`;

  async function listAll(path) {
    const items = [];
    let url = `${API}${path}${path.includes('?') ? '&' : '?'}per_page=100`;
    while (url) {
      const { json, response } = await call(fetchImpl, token, 'GET', url);
      items.push(...json);
      const next = /<([^>]+)>;\s*rel="next"/.exec(response.headers.get('link') ?? '');
      url = next ? next[1] : null;
    }
    return items;
  }

  return {
    async getPull(number) {
      return (await call(fetchImpl, token, 'GET', `${API}${repoPath}/pulls/${number}`)).json;
    },
    async listComments(number) {
      return listAll(`${repoPath}/issues/${number}/comments`);
    },
    async listReviewThreads(number) {
      const query = `query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
        repository(owner: $owner, name: $name) {
          pullRequest(number: $number) {
            reviewThreads(first: 100, after: $cursor) {
              pageInfo { hasNextPage endCursor }
              nodes {
                isResolved
                comments(first: 1) {
                  nodes { author { login } body path line originalLine url originalCommit { oid } }
                }
              }
            }
          }
        }
      }`;
      const threads = [];
      let cursor = null;
      do {
        const { json } = await call(fetchImpl, token, 'POST', `${API}/graphql`, {
          query,
          variables: { owner, name, number, cursor },
        });
        if (json.errors) throw new Error('GitHub GraphQL reviewThreads query failed');
        const connection = json.data.repository.pullRequest.reviewThreads;
        threads.push(...connection.nodes);
        cursor = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
      } while (cursor);
      return threads;
    },
    async findOrCreateCheckRun(headSha) {
      const { json } = await call(
        fetchImpl,
        token,
        'GET',
        `${API}${repoPath}/commits/${headSha}/check-runs?check_name=${encodeURIComponent(CHECK_NAME)}&per_page=100`,
      );
      const existing = json.check_runs.reduce((a, b) => (a && a.id > b.id ? a : b), null);
      if (existing) return existing.id;
      const created = await call(fetchImpl, token, 'POST', `${API}${repoPath}/check-runs`, {
        name: CHECK_NAME,
        head_sha: headSha,
        status: 'in_progress',
        output: { title: 'Checking for a Codex review', summary: 'Starting the Codex gate.' },
      });
      return created.json.id;
    },
    async updateCheckRun(checkRunId, fields) {
      await call(fetchImpl, token, 'PATCH', `${API}${repoPath}/check-runs/${checkRunId}`, fields);
    },
  };
}

async function main(env) {
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  const gh = createGitHub({ token: env.GITHUB_TOKEN, repo: env.GITHUB_REPOSITORY });
  console.log(JSON.stringify(await runGate({ event, gh })));
}

const isEntryPoint = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isEntryPoint) {
  main(process.env).catch((error) => {
    console.error(`::error::${error.message}`);
    process.exit(1);
  });
}
