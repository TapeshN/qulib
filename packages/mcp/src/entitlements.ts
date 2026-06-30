/**
 * Dependency-free, env-only tier entitlement seam for DEEP MCP capabilities.
 *
 * Open-core contract: the local OSS path stays free and no-egress. Gating lives
 * ONLY in @qulib/mcp — core scorers remain tier-agnostic. Tier resolves from
 * TAP_TIER (default "free") with an optional per-request tierOverride hook for a
 * future hosted endpoint; tenantId follows explicit → TAP_TENANT_ID → "default".
 *
 * No network calls — config/env only.
 */

export type Tier = 'free' | 'pro' | 'enterprise';

export type GatedCapability =
  | 'scaffold_tests'
  | 'validate_spec_deep'
  | 'score_decisions_deep'
  | 'full_repo_generation';

export const TAP_TIER_ENV = 'TAP_TIER';
export const TAP_TENANT_ID_ENV = 'TAP_TENANT_ID';

const TIER_RANK: Record<Tier, number> = {
  free: 0,
  pro: 1,
  enterprise: 2,
};

/** Minimum tier required for each DEEP capability (evidence-ladder rungs). */
export const GATED_CAPABILITIES: Record<GatedCapability, Tier> = {
  scaffold_tests: 'pro',
  validate_spec_deep: 'pro',
  score_decisions_deep: 'pro',
  // single-tenant env resolution for now; revisit when hosted per-tenant tier lookup lands
  full_repo_generation: 'enterprise',
};

const FREE_ALTERNATIVES: Partial<Record<GatedCapability, string>> = {
  scaffold_tests:
    'Use analyze_app or qulib_analyze_app for gap analysis and scenario discovery on the free tier.',
  validate_spec_deep:
    'Omit enableLlmJudge or set enableLlmJudge=false for honest insufficient-evidence verdicts via the deterministic path.',
  score_decisions_deep:
    'Omit enableLlmJudge or set enableLlmJudge=false for the deterministic rubric on the free tier.',
  full_repo_generation:
    'Use qulib_scaffold_tests (pro tier) or analyze_app for partial evidence on lower tiers.',
};

export interface EntitlementContext {
  tenantId: string;
  tier: Tier;
}

export interface EntitlementNotice {
  allowed: boolean;
  capability: GatedCapability;
  requiredTier: Tier;
  currentTier: Tier;
  message: string;
  freeAlternative?: string;
}

/** Pure tier check — no I/O. */
export function tierAllows(tier: Tier, capability: GatedCapability): boolean {
  return TIER_RANK[tier] >= TIER_RANK[GATED_CAPABILITIES[capability]];
}

export function resolveTierFromEnv(env: NodeJS.ProcessEnv = process.env): Tier {
  const raw = env[TAP_TIER_ENV]?.trim().toLowerCase();
  if (raw === 'pro' || raw === 'enterprise') return raw;
  return 'free';
}

export function resolveTenantId(explicit?: string, env: NodeJS.ProcessEnv = process.env): string {
  const fromExplicit = explicit?.trim();
  if (fromExplicit) return fromExplicit;
  const fromEnv = env[TAP_TENANT_ID_ENV]?.trim();
  if (fromEnv) return fromEnv;
  return 'default';
}

export function resolveEntitlementContext(options?: {
  tenantId?: string;
  /** Future hosted per-request tier injection — overrides TAP_TIER env. */
  tierOverride?: Tier;
  env?: NodeJS.ProcessEnv;
}): EntitlementContext {
  const env = options?.env ?? process.env;
  return {
    tenantId: resolveTenantId(options?.tenantId, env),
    tier: options?.tierOverride ?? resolveTierFromEnv(env),
  };
}

export function buildEntitlementNotice(
  ctx: EntitlementContext,
  capability: GatedCapability
): EntitlementNotice {
  const requiredTier = GATED_CAPABILITIES[capability];
  const allowed = tierAllows(ctx.tier, capability);
  const freeAlternative = FREE_ALTERNATIVES[capability];
  return {
    allowed,
    capability,
    requiredTier,
    currentTier: ctx.tier,
    message: allowed
      ? `Capability ${capability} is entitled on ${ctx.tier} tier.`
      : `This capability requires the ${requiredTier} tier (current: ${ctx.tier}).`,
    ...(freeAlternative && !allowed ? { freeAlternative } : {}),
  };
}

/** Full-block payload when a DEEP tool has no honest shallow path (e.g. scaffold_tests). */
export function entitlementBlockedPayload(notice: EntitlementNotice): { entitlement: EntitlementNotice } {
  return { entitlement: notice };
}
