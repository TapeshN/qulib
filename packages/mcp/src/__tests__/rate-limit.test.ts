/**
 * Tests for the per-session judge rate limiter and its integration into the
 * two LLM-as-judge MCP handlers (qulib_score_bug_report, qulib_score_decisions).
 *
 * Threat being covered: a tight-loop caller draining the deployer's Anthropic
 * quota (cost/DoS). The unit cases prove the limiter denies past its budget and
 * resumes after the window; the handler cases prove the handlers surface a
 * QULIB_RATE_LIMITED tool error (with no stack-trace detail) when exceeded.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RateLimiter,
  resolveJudgeMaxCallsPerMin,
  resetJudgeRateLimiter,
  JUDGE_MAX_CALLS_ENV,
} from '../rate-limit.js';
import { handleScoreBugReport, handleScoreDecisions } from '../index.js';

// ---------------------------------------------------------------------------
// RateLimiter — deterministic clock injection (no real time, no network)
// ---------------------------------------------------------------------------

test('RateLimiter: allows up to the limit, denies past it, then resumes after the window', () => {
  let clock = 1_000_000;
  const limiter = new RateLimiter({ maxCallsPerMinute: 3, now: () => clock });

  assert.equal(limiter.tryConsume('s1').allowed, true);
  assert.equal(limiter.tryConsume('s1').allowed, true);
  const third = limiter.tryConsume('s1');
  assert.equal(third.allowed, true);
  assert.equal(third.remaining, 0);

  // 4th within the same window is denied, with a positive retry hint.
  const denied = limiter.tryConsume('s1');
  assert.equal(denied.allowed, false);
  assert.equal(denied.limit, 3);
  assert.ok(denied.retryAfterMs > 0 && denied.retryAfterMs <= 60_000, 'retryAfterMs within window');

  // Still denied just before the window elapses.
  clock += 59_999;
  assert.equal(limiter.tryConsume('s1').allowed, false);

  // Window fully elapsed → calls resume.
  clock += 1;
  assert.equal(limiter.tryConsume('s1').allowed, true);
});

test('RateLimiter: windows are isolated per key (per-session)', () => {
  let clock = 0;
  const limiter = new RateLimiter({ maxCallsPerMinute: 1, now: () => clock });
  assert.equal(limiter.tryConsume('a').allowed, true);
  assert.equal(limiter.tryConsume('a').allowed, false);
  // A different session is unaffected by 'a' exhausting its budget.
  assert.equal(limiter.tryConsume('b').allowed, true);
});

test('RateLimiter: maxCallsPerMinute <= 0 disables limiting', () => {
  const limiter = new RateLimiter({ maxCallsPerMinute: 0, now: () => 0 });
  for (let i = 0; i < 200; i++) {
    assert.equal(limiter.tryConsume('x').allowed, true);
  }
});

test('resolveJudgeMaxCallsPerMin: env parsing with default fallback', () => {
  assert.equal(resolveJudgeMaxCallsPerMin({}), 60);
  assert.equal(resolveJudgeMaxCallsPerMin({ [JUDGE_MAX_CALLS_ENV]: '10' }), 10);
  assert.equal(resolveJudgeMaxCallsPerMin({ [JUDGE_MAX_CALLS_ENV]: '  ' }), 60);
  assert.equal(resolveJudgeMaxCallsPerMin({ [JUDGE_MAX_CALLS_ENV]: 'abc' }), 60);
  assert.equal(resolveJudgeMaxCallsPerMin({ [JUDGE_MAX_CALLS_ENV]: '0' }), 0);
});

// ---------------------------------------------------------------------------
// Handler integration — the gate fires inside the real MCP handlers
// ---------------------------------------------------------------------------

const VALID_BUG_REPORT_INPUT = {
  report: {
    title: 'Login button does nothing',
    description: 'Clicking submit on the login form has no visible effect.',
    steps: '1. Go to /login\n2. Enter valid credentials\n3. Click submit',
    severity: 'high' as const,
  },
  target: {
    description: 'Submit handler is not wired to the auth call.',
    type: 'functional',
    severity: 'high' as const,
    expectedBehavior: 'Form submits and the user is authenticated.',
  },
};

async function withJudgeEnv(maxCalls: string, fn: () => Promise<void>): Promise<void> {
  const prevMax = process.env[JUDGE_MAX_CALLS_ENV];
  const prevKey = process.env.ANTHROPIC_API_KEY;
  process.env[JUDGE_MAX_CALLS_ENV] = maxCalls;
  // No API key → deterministic scoring path (no network) while still exercising the gate.
  delete process.env.ANTHROPIC_API_KEY;
  resetJudgeRateLimiter();
  try {
    await fn();
  } finally {
    if (prevMax === undefined) delete process.env[JUDGE_MAX_CALLS_ENV];
    else process.env[JUDGE_MAX_CALLS_ENV] = prevMax;
    if (prevKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prevKey;
    resetJudgeRateLimiter();
  }
}

function errorCode(response: { content: [{ type: 'text'; text: string }] }): string | undefined {
  const body = JSON.parse(response.content[0].text) as { error?: { code?: string; detail?: unknown } };
  return body.error?.code;
}

test('handleScoreBugReport: returns QULIB_RATE_LIMITED once the per-session limit is exceeded', async () => {
  await withJudgeEnv('2', async () => {
    const r1 = await handleScoreBugReport(VALID_BUG_REPORT_INPUT);
    assert.notEqual(errorCode(r1), 'QULIB_RATE_LIMITED');
    const r2 = await handleScoreBugReport(VALID_BUG_REPORT_INPUT);
    assert.notEqual(errorCode(r2), 'QULIB_RATE_LIMITED');

    // Third call in the same window is rejected before any scoring work.
    const r3 = await handleScoreBugReport(VALID_BUG_REPORT_INPUT);
    const body = JSON.parse(r3.content[0].text) as { error: { code: string; detail: unknown } };
    assert.equal(body.error.code, 'QULIB_RATE_LIMITED');
    assert.equal(body.error.detail, null, 'rate-limited error must not leak a stack trace');

    // A different session id has its own budget and is unaffected.
    const other = await handleScoreBugReport(VALID_BUG_REPORT_INPUT, { sessionId: 'other-session' });
    assert.notEqual(errorCode(other), 'QULIB_RATE_LIMITED');
  });
});

test('handleScoreDecisions: rate limit gate runs before path validation', async () => {
  await withJudgeEnv('2', async () => {
    // Bogus relative path → INPUT_INVALID, but each call still consumes budget.
    const bogus = { forksPath: 'not/an/absolute/path.jsonl' };
    const r1 = await handleScoreDecisions(bogus);
    assert.equal(errorCode(r1), 'QULIB_INPUT_INVALID');
    const r2 = await handleScoreDecisions(bogus);
    assert.equal(errorCode(r2), 'QULIB_INPUT_INVALID');

    // Third call is throttled before the path is even examined.
    const r3 = await handleScoreDecisions(bogus);
    assert.equal(errorCode(r3), 'QULIB_RATE_LIMITED');
  });
});
