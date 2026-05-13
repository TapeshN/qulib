import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { RepoAnalysis } from '../schemas/repo-analysis.schema.js';
import type {
  AutomationMaturity,
  AutomationMaturityApplicability,
  AutomationMaturityDimension,
} from '../schemas/automation-maturity.schema.js';
import { AutomationMaturitySchema } from '../schemas/automation-maturity.schema.js';

/**
 * Dimension weights (sum = 1). Breadth + harness adoption dominate: shipping risk is mostly
 * untested routes and missing Playwright/Cypress-level coverage.
 */
const W_TEST_BREADTH = 0.28;
const W_FRAMEWORK = 0.22;
const W_TEST_ID = 0.18;
const W_CI = 0.14;
const W_AUTH_TESTS = 0.1;
const W_COMPONENT_RATIO = 0.08;

function hasCiAtRoot(repoPath: string): { ok: boolean; evidence: string[] } {
  const ev: string[] = [];
  const gh = join(repoPath, '.github', 'workflows');
  if (existsSync(gh) && statSync(gh).isDirectory()) {
    try {
      const files = readdirSync(gh).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
      if (files.length > 0) {
        ev.push(`.github/workflows (${files.length} workflow file(s))`);
        return { ok: true, evidence: ev };
      }
    } catch {
      /* ignore */
    }
  }
  if (existsSync(join(repoPath, '.circleci'))) {
    ev.push('.circleci/ present');
    return { ok: true, evidence: ev };
  }
  for (const f of ['.gitlab-ci.yml', 'Jenkinsfile']) {
    if (existsSync(join(repoPath, f))) {
      ev.push(`${f} present`);
      return { ok: true, evidence: ev };
    }
  }
  return { ok: false, evidence: ['No GitHub Actions, CircleCI, GitLab CI, or Jenkinsfile detected at repo root'] };
}

function scoreLevel(overall: number): { level: number; label: string } {
  if (overall < 20) return { level: 1, label: 'L1 — nascent automation' };
  if (overall < 40) return { level: 2, label: 'L2 — emerging coverage' };
  if (overall < 60) return { level: 3, label: 'L3 — building maturity' };
  if (overall < 80) return { level: 4, label: 'L4 — strong automation' };
  return { level: 5, label: 'L5 — advanced QA automation' };
}

export function computeAutomationMaturity(repo: RepoAnalysis): AutomationMaturity {
  const routePaths = [...new Set(repo.routes.map((r) => r.path))];
  let coveredRoutes = 0;
  for (const p of routePaths) {
    const covered = repo.testFiles.some((tf) =>
      tf.coveredPaths.some((c) => p === c || (c !== '/' && p.startsWith(c)))
    );
    if (covered) coveredRoutes++;
  }
  const breadthScore =
    routePaths.length === 0 ? 100 : Math.round((100 * coveredRoutes) / routePaths.length);
  const breadthDim: AutomationMaturityDimension = {
    dimension: 'test-coverage-breadth',
    score: breadthScore,
    weight: W_TEST_BREADTH,
    evidence:
      routePaths.length === 0
        ? ['No static routes inferred from repo layout']
        : [
            `${coveredRoutes}/${routePaths.length} inferred routes appear in at least one test coveredPaths`,
          ],
    recommendations:
      breadthScore >= 80
        ? []
        : ['Add route-level smoke tests that assert critical paths referenced in production URLs.'],
  };

  const types = new Set(repo.testFiles.map((t) => t.type));
  let frameworkScore = 0;
  const fwEvidence: string[] = [`Test runners seen: ${[...types].join(', ') || 'none'}`];
  if (types.has('playwright') || types.has('cypress-e2e') || types.has('cypress-component')) {
    frameworkScore = 100;
    fwEvidence.push('Playwright or Cypress present — good browser harness signal.');
  } else if (types.has('jest') || types.has('vitest')) {
    frameworkScore = 55;
    fwEvidence.push('Jest/Vitest only — add Playwright or Cypress for deployment-facing checks.');
  } else if (repo.testFiles.length > 0) {
    frameworkScore = 30;
    fwEvidence.push('Tests exist but no recognized browser harness in scanned files.');
  } else {
    frameworkScore = 0;
    fwEvidence.push('No test files matched qulib scan globs.');
  }
  const frameworkDim: AutomationMaturityDimension = {
    dimension: 'framework-adoption',
    score: frameworkScore,
    weight: W_FRAMEWORK,
    evidence: fwEvidence,
    recommendations: frameworkScore >= 80 ? [] : ['Standardize on Playwright or Cypress for E2E against deployed URLs.'],
  };

  const missingIds = repo.missingTestIds.length;
  const interactiveTsxScanned = repo.interactiveTsxFilesScanned ?? missingIds;
  let hygieneScore = 0;
  let hygieneApplicability: AutomationMaturityApplicability = 'applicable';
  let hygieneReason: string | undefined;
  const hygieneEvidence: string[] = [];
  if (interactiveTsxScanned === 0) {
    hygieneApplicability = 'unknown';
    hygieneReason = 'No interactive TSX files scanned — cannot compute a missing-id ratio honestly.';
    hygieneEvidence.push(hygieneReason);
  } else {
    const missingRatio = missingIds / interactiveTsxScanned;
    hygieneScore = Math.round(Math.max(0, 100 * (1 - missingRatio)));
    hygieneEvidence.push(
      `${missingIds}/${interactiveTsxScanned} interactive TSX file(s) lacked data-testid (heuristic scan).`
    );
  }
  const hygieneDim: AutomationMaturityDimension = {
    dimension: 'test-id-hygiene',
    score: hygieneScore,
    weight: W_TEST_ID,
    evidence: hygieneEvidence,
    recommendations:
      hygieneApplicability === 'applicable' && hygieneScore < 85
        ? ['Add stable data-testid (or role-based selectors) on interactive components used in tests.']
        : [],
    applicability: hygieneApplicability,
    ...(hygieneReason && { reason: hygieneReason }),
  };

  const ci = hasCiAtRoot(repo.repoPath);
  const ciDim: AutomationMaturityDimension = {
    dimension: 'ci-integration',
    score: ci.ok ? 100 : 0,
    weight: W_CI,
    evidence: ci.evidence,
    recommendations: ci.ok ? [] : ['Add a CI workflow that runs unit/E2E tests on every PR.'],
  };

  const authRe = /\/(login|auth|signin)(\/|$)/i;
  const authRouteFileRe = /(login|auth|signin)/i;
  const authCovered = repo.testFiles.some((tf) => tf.coveredPaths.some((c) => authRe.test(c)));
  const repoHasAuthRoute = repo.routes.some((r) => authRe.test(r.path));
  const repoHasAuthTestFile = repo.testFiles.some((tf) => authRouteFileRe.test(tf.file));
  const repoHasAnyAuthSignal = repoHasAuthRoute || repoHasAuthTestFile || authCovered;
  let authScore = 0;
  let authApplicability: AutomationMaturityApplicability = 'applicable';
  let authReason: string | undefined;
  const authEvidence: string[] = [];
  if (!repoHasAnyAuthSignal) {
    authApplicability = 'not_applicable';
    authReason = 'No auth routes, auth-named test files, or auth path coverage detected — repo appears auth-free.';
    authEvidence.push(authReason);
  } else {
    authScore = authCovered ? 90 : 25;
    authEvidence.push(
      authCovered
        ? 'At least one test references /login, /auth, or /signin in coveredPaths.'
        : 'Repo has auth-shaped routes or test files but no auth-route coverage in extracted test path strings.'
    );
  }
  const authDim: AutomationMaturityDimension = {
    dimension: 'auth-test-coverage',
    score: authScore,
    weight: W_AUTH_TESTS,
    evidence: authEvidence,
    recommendations:
      authApplicability === 'applicable' && !authCovered
        ? ['Add focused tests for sign-in and post-auth landing behavior.']
        : [],
    applicability: authApplicability,
    ...(authReason && { reason: authReason }),
  };

  const cypressE2e = repo.testFiles.filter((t) => t.type === 'cypress-e2e').length;
  const cypressComp = repo.testFiles.filter((t) => t.type === 'cypress-component').length;
  const cypressTotal = cypressE2e + cypressComp;
  let compRatioScore = 0;
  let compApplicability: AutomationMaturityApplicability = 'applicable';
  let compReason: string | undefined;
  const compEvidence: string[] = [];
  if (cypressTotal === 0) {
    compApplicability = 'not_applicable';
    compReason = 'No Cypress (e2e or component) tests detected — component-test-ratio does not apply.';
    compEvidence.push(compReason);
  } else {
    compRatioScore = Math.round((100 * cypressComp) / cypressTotal);
    compEvidence.push(`Cypress e2e files (matched): ${cypressE2e}, component: ${cypressComp}.`);
  }
  const compDim: AutomationMaturityDimension = {
    dimension: 'component-test-ratio',
    score: compRatioScore,
    weight: W_COMPONENT_RATIO,
    evidence: compEvidence,
    recommendations:
      compApplicability === 'applicable' && cypressComp > 0
        ? ['Balance component vs E2E Cypress tests so critical flows stay fast in CI.']
        : [],
    applicability: compApplicability,
    ...(compReason && { reason: compReason }),
  };

  const dimensions = [breadthDim, frameworkDim, hygieneDim, ciDim, authDim, compDim];

  // Overall score normalizes over applicable dimensions only.
  // overallScore = round( Σ score_i * weight_i / Σ weight_i ) for i ∈ applicable.
  // If no dimension is applicable (degenerate repo), overall = 0 and level = L1.
  const applicableDims = dimensions.filter((d) => (d.applicability ?? 'applicable') === 'applicable');
  const weightSum = applicableDims.reduce((s, d) => s + d.weight, 0);
  const overallScore =
    weightSum > 0
      ? Math.round(applicableDims.reduce((s, d) => s + d.score * d.weight, 0) / weightSum)
      : 0;
  const { level, label } = scoreLevel(overallScore);

  const topRecommendations = [...applicableDims]
    .sort((a, b) => a.score - b.score)
    .flatMap((d) => d.recommendations)
    .filter(Boolean)
    .slice(0, 8);

  return AutomationMaturitySchema.parse({
    computedAt: new Date().toISOString(),
    repoPath: repo.repoPath,
    overallScore,
    level,
    label,
    dimensions,
    topRecommendations,
    scoreFormula:
      'overallScore = round( Σ (score * weight) / Σ weight ) for applicable dimensions only. not_applicable and unknown dimensions are excluded from the denominator.',
  });
}
