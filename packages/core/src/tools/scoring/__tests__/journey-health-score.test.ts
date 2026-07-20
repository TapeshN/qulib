/**
 * Journey health-score unit tests — fixture-driven, no live Cypress run.
 *
 * Golden fixture: datasets/golden/journeys/cypress-results/mixed-pass-fail.json
 * Expected artifact: datasets/golden/journeys/cypress-results/expected-health.json
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeJourneyHealthScore,
  journeyIdFromSuiteTitle,
  scoreFromCounts,
} from '../journey-health-score.js';
import { JourneyHealthScoreSchema } from '../../../schemas/journey-health.schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/core/src/tools/scoring/__tests__ → repo root (6 levels up)
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..', '..');
const RESULTS_FIXTURE = resolve(
  REPO_ROOT,
  'datasets/golden/journeys/cypress-results/mixed-pass-fail.json'
);
const EXPECTED_HEALTH = resolve(
  REPO_ROOT,
  'datasets/golden/journeys/cypress-results/expected-health.json'
);

test('journeyIdFromSuiteTitle: strips @annotations and matches generator ids', () => {
  assert.equal(
    journeyIdFromSuiteTitle('Smoke login flow @smoke @regression'),
    'recorder-smoke-login-flow'
  );
  assert.equal(journeyIdFromSuiteTitle('Checkout flow'), 'recorder-checkout-flow');
});

test('scoreFromCounts: honest empty suite is 0, not 100', () => {
  assert.equal(scoreFromCounts(0, 0), 0);
  assert.equal(scoreFromCounts(2, 1), 67);
  assert.equal(scoreFromCounts(3, 0), 100);
  assert.equal(scoreFromCounts(0, 2), 0);
});

test('computeJourneyHealthScore: golden mixed-pass-fail fixture matches expected artifact', () => {
  const raw = JSON.parse(readFileSync(RESULTS_FIXTURE, 'utf8'));
  const expected = JSON.parse(readFileSync(EXPECTED_HEALTH, 'utf8'));
  const artifact = computeJourneyHealthScore(raw);

  assert.deepEqual(artifact, expected);
  assert.equal(artifact.score, 67);
  assert.deepEqual(artifact.perJourney, [
    { id: 'recorder-checkout-flow', passed: 0, failed: 1 },
    { id: 'recorder-smoke-login-flow', passed: 2, failed: 0 },
  ]);
  // Self-verify against the published schema shape.
  assert.deepEqual(JourneyHealthScoreSchema.parse(artifact), artifact);
});

test('computeJourneyHealthScore: nested suites reporter shape', () => {
  const artifact = computeJourneyHealthScore({
    results: [
      {
        file: 'cypress/e2e/login.cy.ts',
        suites: [
          {
            title: 'Login @smoke',
            tests: [
              { title: 'ok', state: 'passed' },
              { title: 'nope', state: 'failed', err: { message: 'x' } },
            ],
          },
        ],
      },
    ],
  });
  assert.equal(artifact.score, 50);
  assert.deepEqual(artifact.perJourney, [{ id: 'recorder-login', passed: 1, failed: 1 }]);
});

test('computeJourneyHealthScore: rejects malformed envelope', () => {
  assert.throws(() => computeJourneyHealthScore('not-an-object'), /schema validation/i);
});

test('computeJourneyHealthScore: stats-only fixture still produces a score', () => {
  const artifact = computeJourneyHealthScore({ stats: { passes: 4, failures: 1, tests: 5 } });
  assert.equal(artifact.score, 80);
  assert.equal(artifact.perJourney.length, 1);
  assert.equal(artifact.perJourney[0]?.passed, 4);
  assert.equal(artifact.perJourney[0]?.failed, 1);
});
