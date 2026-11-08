// Codex gate: turns Codex review findings into the required check run "Codex review".
//
// Two modes, run from a checkout of main (never of PR code):
//   node scripts/codex-gate.mjs request  Posts "@codex review" once per head SHA, only when
//                                         repository variable CODEX_REVIEW_COMMENT is "1".
//   node scripts/codex-gate.mjs gate     Writes the "Codex review" check run for the head SHA.
//
// Everything above the I/O layer is a pure function (unit-tested in tests/unit/codex-gate.test.js).

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const CHECK_NAME = 'Codex review';
export const CODEX_LOGINS = ['chatgpt-codex-connector[bot]', 'chatgpt-codex-connector'];
export const BOT_LOGINS = ['github-actions[bot]', 'github-actions'];
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

export function isBotLogin(login) {
  return BOT_LOGINS.includes(login);
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

const WAITING_REASON = {
  missing: 'No Codex summary for this commit yet.',
  stale: (sha) => `Codex last reviewed ${sha?.slice(0, 7) ?? 'another commit'}, not this one.`,
  'not-completed': 'The Codex review is still running.',
};

export function waitingCheck({ headSha, evaluation, requestEnabled }) {
  const short = headSha.slice(0, 7);
  const reason = WAITING_REASON[evaluation.reason];
  const detail = typeof reason === 'function' ? reason(evaluation.reviewedSha) : reason;
  const hint = requestEnabled
    ? 'This gate requests a review with "@codex review" when needed.'
    : 'Codex must review this commit on its own (automatic review on push).';
  return {
    status: 'in_progress',
    output: {
      title: 'Waiting for Codex',
      summary: `Waiting for Codex on ${short}. ${detail} ${hint}`,
    },
  };
}

export function reviewRequestEnabled(value) {
  return value === '1';
}

export function requestMarker(headSha) {
  return `<!-- codex-gate-review-request sha=${headSha} -->`;
}

export function requestBody(headSha) {
  return `${REVIEW_REQUEST_TEXT}\n\n${requestMarker(headSha)}`;
}

// Counts only markers written by the Actions bot, so a person cannot suppress the request.
export function hasReviewRequest(comments, headSha) {
  const marker = requestMarker(headSha);
  return comments.some((c) => isBotLogin(c.user?.login) && (c.body ?? '').includes(marker));
}

export function shouldRequestReview({ enabled, evaluation, comments, headSha }) {
  if (!enabled) return false;
  if (evaluation.reason !== 'missing' && evaluation.reason !== 'stale') return false;
  return !hasReviewRequest(comments, headSha);
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

export async function runRequest({ env, event, gh }) {
  const enabled = reviewRequestEnabled(env.CODEX_REVIEW_COMMENT);
  if (!enabled) return { posted: false, reason: 'disabled' };
  const number = prNumberFromEvent(event);
  if (number === null) return { posted: false, reason: 'not a pull request' };
  const pr = await gh.getPull(number);
  if (isForkPr(pr)) throw new Error(FORK_MESSAGE);
  const headSha = pr.head.sha;
  const comments = await gh.listComments(number);
  const evaluation = evaluateReview({ summary: findLatestSummary(comments), headSha });
  if (!shouldRequestReview({ enabled, evaluation, comments, headSha })) {
    return { posted: false, reason: `no request needed (${evaluation.reason})` };
  }
  await gh.createComment(number, requestBody(headSha));
  return { posted: true, headSha };
}

export async function runGate({ env, event, gh }) {
  const number = prNumberFromEvent(event);
  if (number === null) return { state: 'skipped', reason: 'not a pull request' };
  const pr = await gh.getPull(number);
  if (isForkPr(pr)) throw new Error(FORK_MESSAGE);
  const headSha = pr.head.sha;
  const checkRunId = await gh.findOrCreateCheckRun(headSha);

  const comments = await gh.listComments(number);
  const evaluation = evaluateReview({ summary: findLatestSummary(comments), headSha });
  if (!evaluation.ready) {
    await gh.updateCheckRun(checkRunId, waitingCheck({
      headSha,
      evaluation,
      requestEnabled: reviewRequestEnabled(env.CODEX_REVIEW_COMMENT),
    }));
    return { state: 'waiting', reason: evaluation.reason };
  }

  const findings = unresolvedFindings(await gh.listReviewThreads(number));
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
    async createComment(number, body) {
      await call(fetchImpl, token, 'POST', `${API}${repoPath}/issues/${number}/comments`, { body });
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
                  nodes { author { login } body path line originalLine url }
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
        output: { title: 'Waiting for Codex', summary: 'Starting the Codex gate.' },
      });
      return created.json.id;
    },
    async updateCheckRun(checkRunId, fields) {
      await call(fetchImpl, token, 'PATCH', `${API}${repoPath}/check-runs/${checkRunId}`, fields);
    },
  };
}

async function main(argv, env) {
  const mode = argv[2];
  if (mode !== 'request' && mode !== 'gate') {
    throw new Error('usage: node scripts/codex-gate.mjs <request|gate>');
  }
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  const gh = createGitHub({ token: env.GITHUB_TOKEN, repo: env.GITHUB_REPOSITORY });
  const result = mode === 'request' ? await runRequest({ env, event, gh }) : await runGate({ env, event, gh });
  console.log(JSON.stringify({ mode, ...result }));
}

const isEntryPoint = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isEntryPoint) {
  main(process.argv, process.env).catch((error) => {
    console.error(`::error::${error.message}`);
    process.exit(1);
  });
}
