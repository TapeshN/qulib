/**
 * Dependency-free, in-process per-session rate limiter for the LLM-as-judge MCP
 * tools (qulib_score_bug_report, qulib_score_decisions).
 *
 * Threat (flagged MEDIUM in two security reviews): per-field Zod length caps stop
 * single-call abuse, but a programmatic/direct MCP client can fire either judge
 * tool in a tight loop and drain the deployer's Anthropic API quota (cost/DoS).
 * This caps the number of judge calls per caller per rolling 60s window and lets
 * the handler return a structured QULIB_RATE_LIMITED tool error instead of
 * reaching the LLM.
 *
 * Implementation note — fixed-window counter: chosen for being allocation-light,
 * dependency-free, and because "calls resume after the window" maps directly to
 * its semantics. The classic up-to-2x burst at a window boundary is acceptable
 * for a cost guard — the goal is to stop unbounded tight loops, not to enforce a
 * precise SLA. Keying is per session id when the transport provides one (e.g.
 * Streamable HTTP); stdio has a single session so all calls share one window.
 */

const WINDOW_MS = 60_000;
const DEFAULT_MAX_CALLS_PER_MIN = 60;
/** Env var that overrides the default per-session judge call budget. */
export const JUDGE_MAX_CALLS_ENV = 'QULIB_JUDGE_MAX_CALLS_PER_MIN';
/** Above this many tracked keys, sweep expired windows to bound memory. */
const SWEEP_THRESHOLD = 1000;

export interface RateLimitDecision {
  /** Whether this call is permitted. */
  allowed: boolean;
  /** Configured limit (calls per window). 0 means the limiter is disabled. */
  limit: number;
  /** Calls remaining in the current window after this decision. */
  remaining: number;
  /** Milliseconds until the current window resets (0 when allowed or disabled). */
  retryAfterMs: number;
}

interface WindowState {
  windowStart: number;
  count: number;
}

export interface RateLimiterOptions {
  /** Max allowed calls per 60s window. <= 0 disables the limiter (always allow). */
  maxCallsPerMinute: number;
  /** Injectable clock for deterministic tests. Defaults to Date.now. */
  now?: () => number;
}

export class RateLimiter {
  private readonly maxCalls: number;
  private readonly now: () => number;
  private readonly windows = new Map<string, WindowState>();

  constructor(options: RateLimiterOptions) {
    this.maxCalls = Number.isFinite(options.maxCallsPerMinute)
      ? Math.floor(options.maxCallsPerMinute)
      : DEFAULT_MAX_CALLS_PER_MIN;
    this.now = options.now ?? Date.now;
  }

  /** Configured per-window call budget (0 = disabled). */
  get limit(): number {
    return this.maxCalls;
  }

  /** Record one call against `key` and report whether it is permitted. */
  tryConsume(key: string): RateLimitDecision {
    // <= 0 disables the limiter entirely (escape hatch for trusted deployments).
    if (this.maxCalls <= 0) {
      return { allowed: true, limit: this.maxCalls, remaining: Number.POSITIVE_INFINITY, retryAfterMs: 0 };
    }

    const t = this.now();
    const state = this.windows.get(key);

    if (!state || t - state.windowStart >= WINDOW_MS) {
      // Fresh window (first call for this key, or the prior window has elapsed).
      if (!state && this.windows.size >= SWEEP_THRESHOLD) this.sweepExpired(t);
      this.windows.set(key, { windowStart: t, count: 1 });
      return { allowed: true, limit: this.maxCalls, remaining: this.maxCalls - 1, retryAfterMs: 0 };
    }

    if (state.count < this.maxCalls) {
      state.count += 1;
      return { allowed: true, limit: this.maxCalls, remaining: this.maxCalls - state.count, retryAfterMs: 0 };
    }

    // Over budget for this window.
    const retryAfterMs = Math.max(0, WINDOW_MS - (t - state.windowStart));
    return { allowed: false, limit: this.maxCalls, remaining: 0, retryAfterMs };
  }

  /** Drop all per-key window state (test/util). */
  reset(): void {
    this.windows.clear();
  }

  /** Evict windows whose 60s span has fully elapsed — bounds memory under key churn. */
  private sweepExpired(t: number): void {
    for (const [key, state] of this.windows) {
      if (t - state.windowStart >= WINDOW_MS) this.windows.delete(key);
    }
  }
}

/** Parse the configured per-session budget from the environment (default 60). */
export function resolveJudgeMaxCallsPerMin(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[JUDGE_MAX_CALLS_ENV]?.trim();
  if (raw === undefined || raw === '') return DEFAULT_MAX_CALLS_PER_MIN;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_CALLS_PER_MIN;
  return Math.floor(parsed);
}

let singleton: RateLimiter | null = null;

/** Process-wide judge rate limiter, lazily built from QULIB_JUDGE_MAX_CALLS_PER_MIN. */
export function getJudgeRateLimiter(): RateLimiter {
  if (!singleton) {
    singleton = new RateLimiter({ maxCallsPerMinute: resolveJudgeMaxCallsPerMin() });
  }
  return singleton;
}

/** Rebuild the singleton from the current env (tests / config reload). */
export function resetJudgeRateLimiter(): void {
  singleton = null;
}

/** Derive the rate-limit bucket key from the MCP request context. */
export function sessionKey(extra?: { sessionId?: string }): string {
  return extra?.sessionId ?? 'default';
}
