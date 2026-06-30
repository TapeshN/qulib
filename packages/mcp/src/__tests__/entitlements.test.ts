/**
 * Entitlement seam tests — tier resolution, honest gating, byte-identity of free tools,
 * and proof of no network egress in entitlement resolution.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GATED_CAPABILITIES,
  TAP_TIER_ENV,
  TAP_TENANT_ID_ENV,
  buildEntitlementNotice,
  resolveEntitlementContext,
  resolveTierFromEnv,
  resolveTenantId,
  tierAllows,
} from '../entitlements.js';
import {
  handleQulibDiff,
  handleScoreDecisions,
  handleScaffoldTests,
  handleValidateSpec,
} from '../index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURE_ROOT = resolve(__dirname, '..', '..', '..', 'core', 'fixtures');
const CLEAN_FIXTURE = resolve(FIXTURE_ROOT, 'baselines', 'clean-run.json');
const FORKS_FIXTURE = resolve(FIXTURE_ROOT, 'forks.jsonl');

async function withEnv(
  overrides: Record<string, string | undefined>,
  fn: () => Promise<void>
): Promise<void> {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = process.env[key];
    const val = overrides[key];
    if (val === undefined) delete process.env[key];
    else process.env[key] = val;
  }
  try {
    await fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

function parseText(response: { content: [{ type: 'text'; text: string }] }): Record<string, unknown> {
  return JSON.parse(response.content[0].text) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Pure tier logic — no I/O
// ---------------------------------------------------------------------------

test('tierAllows: free tier denies all DEEP capabilities', () => {
  for (const cap of Object.keys(GATED_CAPABILITIES) as (keyof typeof GATED_CAPABILITIES)[]) {
    assert.equal(tierAllows('free', cap), false, cap);
  }
});

test('tierAllows: pro tier allows pro rungs but not enterprise-only', () => {
  assert.equal(tierAllows('pro', 'scaffold_tests'), true);
  assert.equal(tierAllows('pro', 'validate_spec_deep'), true);
  assert.equal(tierAllows('pro', 'score_decisions_deep'), true);
  assert.equal(tierAllows('pro', 'full_repo_generation'), false);
});

test('tierAllows: enterprise tier allows every gated capability', () => {
  for (const cap of Object.keys(GATED_CAPABILITIES) as (keyof typeof GATED_CAPABILITIES)[]) {
    assert.equal(tierAllows('enterprise', cap), true, cap);
  }
});

test('resolveTierFromEnv and resolveTenantId: env precedence and defaults', () => {
  assert.equal(resolveTierFromEnv({}), 'free');
  assert.equal(resolveTierFromEnv({ [TAP_TIER_ENV]: 'pro' }), 'pro');
  assert.equal(resolveTierFromEnv({ [TAP_TIER_ENV]: 'ENTERPRISE' }), 'enterprise');
  assert.equal(resolveTierFromEnv({ [TAP_TIER_ENV]: 'bogus' }), 'free');

  assert.equal(resolveTenantId(undefined, {}), 'default');
  assert.equal(resolveTenantId('explicit', { [TAP_TENANT_ID_ENV]: 'env-tenant' }), 'explicit');
  assert.equal(resolveTenantId(undefined, { [TAP_TENANT_ID_ENV]: 'env-tenant' }), 'env-tenant');
});

test('resolveEntitlementContext: tierOverride wins over env (hosted per-request hook)', () => {
  const ctx = resolveEntitlementContext({
    tenantId: 'team-a',
    tierOverride: 'enterprise',
    env: { [TAP_TIER_ENV]: 'free' },
  });
  assert.equal(ctx.tenantId, 'team-a');
  assert.equal(ctx.tier, 'enterprise');
});

test('entitlement resolution performs no fetch/egress', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (() => {
    fetchCalls += 1;
    throw new Error('fetch must not be called by entitlements');
  }) as typeof fetch;

  try {
    resolveEntitlementContext({ env: { [TAP_TIER_ENV]: 'pro', [TAP_TENANT_ID_ENV]: 't1' } });
    buildEntitlementNotice(resolveEntitlementContext(), 'scaffold_tests');
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// Free-tier byte identity — currently-free tools unchanged when TAP_TIER unset
// ---------------------------------------------------------------------------

test('handleQulibDiff: byte-identical output on free tier (baseline fixture)', async () => {
  await withEnv({ [TAP_TIER_ENV]: undefined, ANTHROPIC_API_KEY: undefined }, async () => {
    const input = { from: CLEAN_FIXTURE, to: CLEAN_FIXTURE, labelFrom: 'a', labelTo: 'b' };
    const r1 = await handleQulibDiff(input);
    const r2 = await handleQulibDiff(input);
    assert.equal(r1.content[0].text, r2.content[0].text);
    const body = parseText(r1);
    assert.equal(body['direction'], 'unchanged');
    assert.ok(!('entitlement' in body));
  });
});

test('handleScoreDecisions: deterministic path byte-identical on free tier', async () => {
  await withEnv(
    {
      [TAP_TIER_ENV]: undefined,
      ANTHROPIC_API_KEY: undefined,
      QULIB_FORKS_ALLOWED_ROOT: dirname(FORKS_FIXTURE),
    },
    async () => {
      const input = { forksPath: FORKS_FIXTURE, enableLlmJudge: false };
      const r1 = await handleScoreDecisions(input);
      const r2 = await handleScoreDecisions(input);
      assert.equal(r1.content[0].text, r2.content[0].text);
      const body = parseText(r1);
      assert.ok(!('entitlement' in body));
      assert.ok(typeof body['aggregate'] === 'object');
      const agg = body['aggregate'] as Record<string, unknown>;
      assert.ok(Number(agg['count']) >= 1);
      assert.ok(!('error' in body));
    }
  );
});

// ---------------------------------------------------------------------------
// DEEP tool gating — honest shallow or tier notice, never throw, no fabricated scores
// ---------------------------------------------------------------------------

test('handleScaffoldTests: free tier returns entitlement block without scaffold output', async () => {
  await withEnv({ [TAP_TIER_ENV]: 'free' }, async () => {
    const response = await handleScaffoldTests({
      url: 'https://example.com',
      framework: 'cypress-e2e',
    });
    const body = parseText(response);
    assert.ok('entitlement' in body);
    const ent = body['entitlement'] as Record<string, unknown>;
    assert.equal(ent['allowed'], false);
    assert.equal(ent['capability'], 'scaffold_tests');
    assert.equal(ent['requiredTier'], 'pro');
    assert.ok(typeof ent['freeAlternative'] === 'string');
    assert.ok(!('generatedTests' in body));
    assert.ok(!('error' in body));
  });
});

test('handleScoreDecisions: free tier + enableLlmJudge=true falls back to deterministic with notice', async () => {
  await withEnv(
    {
      [TAP_TIER_ENV]: 'free',
      ANTHROPIC_API_KEY: 'sk-test-should-not-be-used',
      QULIB_FORKS_ALLOWED_ROOT: dirname(FORKS_FIXTURE),
    },
    async () => {
      const response = await handleScoreDecisions({
        forksPath: FORKS_FIXTURE,
        enableLlmJudge: true,
      });
      const body = parseText(response);
      assert.ok('entitlement' in body);
      const ent = body['entitlement'] as Record<string, unknown>;
      assert.equal(ent['allowed'], false);
      assert.equal(ent['capability'], 'score_decisions_deep');
      assert.ok(!('error' in body));
      const scored = body['scored'] as Array<Record<string, unknown>>;
      assert.ok(scored.length >= 1);
      assert.equal(scored[0]['scoringPath'], 'deterministic');
    }
  );
});

test('handleValidateSpec: free tier + enableLlmJudge=true returns shallow verdict with notice', async () => {
  await withEnv({ [TAP_TIER_ENV]: 'free', ANTHROPIC_API_KEY: 'sk-test-should-not-be-used' }, async () => {
    const response = await handleValidateSpec({
      requirements: [{ id: 'req-1', text: 'Login form accepts valid credentials.' }],
      observed: { summary: 'User can log in with email and password on /login.' },
      enableLlmJudge: true,
    });
    const body = parseText(response);
    assert.ok('entitlement' in body);
    const ent = body['entitlement'] as Record<string, unknown>;
    assert.equal(ent['allowed'], false);
    assert.equal(body['verdict'], 'insufficient-evidence');
    assert.ok(!('error' in body));
    const reqs = body['requirements'] as Array<Record<string, unknown>>;
    assert.equal(reqs[0]['conforms'], 'unknown');
    assert.equal(reqs[0]['scoringPath'], 'deterministic-fallback');
  });
});

test('handleValidateSpec: free tier without enableLlmJudge is byte-identical (no entitlement field)', async () => {
  await withEnv({ [TAP_TIER_ENV]: undefined, ANTHROPIC_API_KEY: undefined }, async () => {
    const input = {
      requirements: [{ id: 'req-1', text: 'Homepage loads.' }],
      observed: { summary: 'GET / returns 200 with a title.' },
    };
    const r1 = await handleValidateSpec(input);
    const r2 = await handleValidateSpec(input);
    assert.equal(r1.content[0].text, r2.content[0].text);
    const body = parseText(r1);
    assert.ok(!('entitlement' in body));
    assert.equal(body['verdict'], 'insufficient-evidence');
  });
});

// ---------------------------------------------------------------------------
// Entitled tier — gate opens (scaffold still needs live crawl; decisions/spec use fixtures)
// ---------------------------------------------------------------------------

test('handleScoreDecisions: enterprise tier + enableLlmJudge passes entitlement gate', async () => {
  await withEnv(
    {
      [TAP_TIER_ENV]: 'enterprise',
      ANTHROPIC_API_KEY: undefined,
      QULIB_FORKS_ALLOWED_ROOT: dirname(FORKS_FIXTURE),
    },
    async () => {
      const response = await handleScoreDecisions({
        forksPath: FORKS_FIXTURE,
        enableLlmJudge: true,
      });
      const body = parseText(response);
      assert.ok(!('entitlement' in body), 'entitled deep path must not add a block notice');
      assert.ok(!('error' in body));
      const scored = body['scored'] as Array<Record<string, unknown>>;
      assert.equal(scored[0]['scoringPath'], 'deterministic');
    }
  );
});

test('handleScaffoldTests: enterprise tier does not return entitlement block', async () => {
  await withEnv({ [TAP_TIER_ENV]: 'enterprise' }, async () => {
    const response = await handleScaffoldTests({
      url: 'https://127.0.0.1:1/unreachable-for-test',
      framework: 'cypress-e2e',
      maxPagesToScan: 1,
    });
    const body = parseText(response);
    assert.ok(!('entitlement' in body) || (body['entitlement'] as Record<string, unknown>)['allowed'] !== false);
    // Entitlement gate passed — handler proceeds (may fail on crawl, but not on tier).
    const hasScaffoldOutput = 'generatedTests' in body;
    const hasToolError = 'error' in body;
    assert.ok(hasScaffoldOutput || hasToolError, 'entitled call must reach scaffold or a non-entitlement error');
    if (hasToolError) {
      const err = body['error'] as Record<string, unknown>;
      assert.notEqual(err['code'], 'QULIB_ENTITLEMENT_DENIED');
    }
  });
});

test('buildEntitlementNotice: includes freeAlternative text for blocked capabilities', () => {
  const notice = buildEntitlementNotice(resolveEntitlementContext({ env: {} }), 'scaffold_tests');
  assert.equal(notice.allowed, false);
  assert.match(notice.freeAlternative ?? '', /analyze_app/);
});
