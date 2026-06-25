/**
 * Provenance grading + Witnessed-State-Ratio (WSR) — pure scorer.
 *
 * Deterministic only — no LLM self-judgment. Grades each evidence item by its
 * collector trail, applies TTL decay for stale evidence, and computes:
 *
 *   WSR = W / (W + C + S)
 *
 * where W = witnessed mass, C = claimed mass, S = stale mass.
 *
 * Ship gate: shipGate='no-ship' when WSR < policy.wsrShipThreshold.
 */

import type { EvidenceItem } from '../../schemas/confidence.schema.js';
import type {
  ChangeType,
  EvidenceStateClass,
  GradedEvidence,
  ProvenanceGrade,
  ProvenanceInput,
  ProvenancePolicy,
  ProvenanceScore,
  WitnessCoverageGap,
  WitnessRequirement,
} from '../../schemas/provenance.schema.js';
import {
  PROVENANCE_RUBRIC_VERSION,
  ProvenancePolicySchema,
  ProvenanceScoreSchema,
} from '../../schemas/provenance.schema.js';

/** Numeric w_i ladder for provenance grades. */
export const GRADE_WEIGHTS: Record<ProvenanceGrade, number> = {
  high: 1.0,
  mid: 0.6,
  low: 0.3,
  none: 0,
};

/** qulib-native and adapter tools that execute real collectors. */
const QULIB_EXECUTION_PREFIXES = ['qulib.', 'qulib:'];

/** Change-type → required witness taxonomy (witnessed-coverage). */
export const WITNESS_TAXONOMY: readonly WitnessRequirement[] = [
  {
    changeType: 'refactor',
    requiredWitness: 'output-diff',
    description: 'Refactors must show output-diff or behavioral equivalence proof.',
  },
  {
    changeType: 'new-export',
    requiredWitness: 'runtime-import-check',
    description: 'New public exports require a runtime import/resolution check.',
  },
  {
    changeType: 'artifact-reader',
    requiredWitness: 'real-on-disk-test',
    description: 'Artifact readers must be exercised against real on-disk fixtures.',
  },
  {
    changeType: 'config-change',
    requiredWitness: 'config-validation-run',
    description: 'Config changes require a validation or smoke run.',
  },
  {
    changeType: 'dependency-bump',
    requiredWitness: 'ci-test-suite',
    description: 'Dependency bumps require a full CI test suite pass.',
  },
  {
    changeType: 'test-addition',
    requiredWitness: 'test-execution-log',
    description: 'New tests must appear in an executed test log.',
  },
] as const;

const MIN_FRESHNESS = 0.25;

function resolvePolicy(p: ProvenancePolicy | undefined): ProvenancePolicy {
  return ProvenancePolicySchema.parse(p ?? {});
}

function isQulibExecutionTool(tool: string): boolean {
  return QULIB_EXECUTION_PREFIXES.some((prefix) => tool.startsWith(prefix));
}

function isAdapterTool(tool: string): boolean {
  return tool.includes('-adapter') || tool.endsWith('.adapter');
}

function isHttpRef(ref: string | undefined): boolean {
  return ref !== undefined && /^https?:\/\//i.test(ref);
}

/**
 * Deterministic per-evidence provenance grade from collector metadata.
 * NO LLM — rules only.
 */
export function gradeEvidenceItem(item: EvidenceItem): ProvenanceGrade {
  const tool = item.collector?.tool?.trim() ?? '';

  if (!tool || tool === 'bare-assertion' || tool === 'human-claim' || tool === 'assertion') {
    return 'none';
  }

  const inputRef = item.collector.inputRef?.trim();

  if (item.source === 'ci-results' && inputRef) {
    return 'high';
  }

  if (isQulibExecutionTool(tool)) {
    return 'high';
  }

  if (isAdapterTool(tool)) {
    return inputRef ? 'high' : 'low';
  }

  if (item.source === 'agent-evidence') {
    return 'none';
  }

  if (isHttpRef(inputRef)) {
    return 'mid';
  }

  if (tool && !inputRef) {
    return 'low';
  }

  return 'none';
}

function computeAgeSeconds(collectedAt: string, referenceTime: string): number {
  const ageMs = Date.parse(referenceTime) - Date.parse(collectedAt);
  return Math.max(0, ageMs / 1000);
}

function computeFreshnessFactor(
  ageSeconds: number,
  policy: ProvenancePolicy
): number {
  if (ageSeconds <= policy.freshThresholdSeconds) {
    return 1;
  }
  if (ageSeconds >= policy.staleAfterSeconds) {
    return 0;
  }
  const decayWindow = policy.staleAfterSeconds - policy.freshThresholdSeconds;
  const elapsed = ageSeconds - policy.freshThresholdSeconds;
  return MIN_FRESHNESS + (1 - MIN_FRESHNESS) * (1 - elapsed / decayWindow);
}

function classifyState(
  grade: ProvenanceGrade,
  freshnessFactor: number
): EvidenceStateClass {
  if (freshnessFactor === 0) {
    return 'stale';
  }
  if (grade === 'high') {
    return 'witnessed';
  }
  return 'claimed';
}

function buildGradeRationale(
  item: EvidenceItem,
  grade: ProvenanceGrade,
  stateClass: EvidenceStateClass,
  freshnessFactor: number
): string {
  const tool = item.collector?.tool ?? '(none)';
  const ref = item.collector.inputRef;

  if (stateClass === 'stale') {
    return `'${item.source}' evidence is stale (TTL expired) — collector=${tool}.`;
  }

  switch (grade) {
    case 'high':
      return `'${item.source}' witnessed via tool/CI/artifact trail — collector=${tool}${ref ? `, ref=${ref}` : ''}.`;
    case 'mid':
      return `'${item.source}' verified-external — collector=${tool}, ref=${ref}.`;
    case 'low':
      return `'${item.source}' unverified — collector=${tool} without verifiable ref.`;
    default:
      return `'${item.source}' bare assertion — no execution trail (collector=${tool || 'none'}).`;
  }
}

function gradeSingleItem(
  item: EvidenceItem,
  policy: ProvenancePolicy,
  referenceTime: string
): GradedEvidence {
  const grade = gradeEvidenceItem(item);
  const ageSeconds = computeAgeSeconds(item.collectedAt, referenceTime);
  const freshnessFactor = computeFreshnessFactor(ageSeconds, policy);
  const stateClass = classifyState(grade, freshnessFactor);
  const baseWeight = item.weight > 0 ? item.weight : 0.1;
  const mass = stateClass === 'stale' ? baseWeight : baseWeight * freshnessFactor;

  return {
    source: item.source,
    grade,
    gradeWeight: GRADE_WEIGHTS[grade],
    stateClass,
    mass,
    freshnessFactor,
    ageSeconds,
    collectorTool: item.collector?.tool ?? '',
    inputRef: item.collector?.inputRef,
    rationale: buildGradeRationale(item, grade, stateClass, freshnessFactor),
  };
}

function computeWsrTotals(graded: GradedEvidence[]): {
  wsr: number | null;
  witnessedMass: number;
  claimedMass: number;
  staleMass: number;
} {
  let witnessedMass = 0;
  let claimedMass = 0;
  let staleMass = 0;

  for (const g of graded) {
    if (g.stateClass === 'witnessed') {
      witnessedMass += g.mass;
    } else if (g.stateClass === 'stale') {
      staleMass += g.mass;
    } else {
      claimedMass += g.mass;
    }
  }

  const denominator = witnessedMass + claimedMass + staleMass;
  const wsr = denominator > 0 ? witnessedMass / denominator : null;

  return { wsr, witnessedMass, claimedMass, staleMass };
}

function hasWitnessForChangeType(
  changeType: ChangeType,
  graded: GradedEvidence[]
): boolean {
  const requirement = WITNESS_TAXONOMY.find((w) => w.changeType === changeType);
  if (!requirement) {
    return false;
  }

  const witnessKeyword = requirement.requiredWitness.toLowerCase();

  return graded.some((g) => {
    if (g.stateClass !== 'witnessed') {
      return false;
    }
    const haystack = `${g.source} ${g.collectorTool} ${g.inputRef ?? ''} ${g.rationale}`.toLowerCase();
    if (haystack.includes(witnessKeyword)) {
      return true;
    }
    switch (changeType) {
      case 'dependency-bump':
        return g.source === 'ci-results' && g.grade === 'high';
      case 'test-addition':
        return g.source === 'ci-results' || g.collectorTool.includes('test');
      case 'new-export':
        return g.collectorTool.includes('import') || g.collectorTool.includes('analyze');
      case 'artifact-reader':
        return g.collectorTool.includes('fixture') || g.collectorTool.includes('on-disk');
      case 'refactor':
        return g.collectorTool.includes('diff') || g.inputRef?.includes('diff') === true;
      case 'config-change':
        return g.collectorTool.includes('config') || g.collectorTool.includes('smoke');
      default:
        return false;
    }
  });
}

function buildWitnessCoverage(
  changeTypes: ChangeType[] | undefined,
  graded: GradedEvidence[]
): WitnessCoverageGap[] {
  if (!changeTypes || changeTypes.length === 0) {
    return [];
  }

  return changeTypes.map((changeType) => {
    const requirement =
      WITNESS_TAXONOMY.find((w) => w.changeType === changeType) ??
      WITNESS_TAXONOMY.find((w) => w.changeType === 'unknown') ?? {
        changeType: 'unknown' as ChangeType,
        requiredWitness: 'execution-trail',
        description: 'Unknown change types require at least one witnessed evidence item.',
      };

    return {
      changeType,
      requiredWitness: requirement.requiredWitness,
      description: requirement.description,
      satisfied: hasWitnessForChangeType(changeType, graded),
    };
  });
}

function buildHonestyNotes(
  graded: GradedEvidence[],
  wsr: number | null,
  shipGate: 'ship' | 'no-ship',
  policy: ProvenancePolicy,
  witnessCoverage: WitnessCoverageGap[]
): string[] {
  const notes: string[] = [];

  if (wsr === null) {
    notes.push('No evidence mass available — WSR is null (honesty floor).');
  } else {
    const pct = Math.round(wsr * 100);
    notes.push(
      `WSR=${pct}% (witnessed=${graded.filter((g) => g.stateClass === 'witnessed').length}, ` +
        `claimed=${graded.filter((g) => g.stateClass === 'claimed').length}, ` +
        `stale=${graded.filter((g) => g.stateClass === 'stale').length}).`
    );
  }

  if (shipGate === 'no-ship') {
    const thresholdPct = Math.round(policy.wsrShipThreshold * 100);
    notes.push(
      `Ship gate NO-SHIP: WSR below threshold (${thresholdPct}%). Release green is CLAIMED, not WITNESSED.`
    );
  }

  for (const g of graded.filter((item) => item.grade === 'none')) {
    notes.push(g.rationale);
  }

  for (const gap of witnessCoverage.filter((w) => !w.satisfied)) {
    notes.push(
      `Witness coverage gap: ${gap.changeType} requires '${gap.requiredWitness}' — not satisfied.`
    );
  }

  return notes;
}

/**
 * Compute provenance score + WSR from an evidence bundle.
 *
 * Pure function — deterministic over the same input and reference time.
 */
export function computeProvenanceScore(
  input: ProvenanceInput,
  referenceTime?: string
): ProvenanceScore {
  const policy = resolvePolicy(input.policy);
  const now = referenceTime ?? new Date().toISOString();

  const gradedEvidence = input.evidence.map((item) => gradeSingleItem(item, policy, now));
  const { wsr, witnessedMass, claimedMass, staleMass } = computeWsrTotals(gradedEvidence);

  const shipGate =
    wsr !== null && wsr >= policy.wsrShipThreshold ? ('ship' as const) : ('no-ship' as const);

  const witnessCoverage = buildWitnessCoverage(input.changeTypes, gradedEvidence);
  const honestyNotes = buildHonestyNotes(
    gradedEvidence,
    wsr,
    shipGate,
    policy,
    witnessCoverage
  );

  const result = {
    schemaVersion: 1 as const,
    computedAt: now,
    rubricVersion: PROVENANCE_RUBRIC_VERSION,
    subject: input.subject,
    wsr,
    witnessedMass,
    claimedMass,
    staleMass,
    shipGate,
    gradedEvidence,
    witnessCoverage,
    honestyNotes,
    formula:
      'WSR = W / (W + C + S) where W=witnessed mass (high grade × freshness), ' +
      'C=claimed mass (mid/low/none), S=stale mass (TTL expired). ' +
      `Rubric ${PROVENANCE_RUBRIC_VERSION}; ship when WSR >= ${policy.wsrShipThreshold}.`,
  };

  return ProvenanceScoreSchema.parse(result);
}
