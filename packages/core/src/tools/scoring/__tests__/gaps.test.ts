import test from 'node:test';
import assert from 'node:assert/strict';
import { computeCoverageScore, computeQualityScoreFromGaps } from '../gaps.js';
import type { RouteInventory, Route } from '../../../schemas/route-inventory.schema.js';
import type { Gap } from '../../../schemas/gap-analysis.schema.js';

function routesInv(partial: Partial<RouteInventory> & Pick<RouteInventory, 'routes'>): RouteInventory {
  return {
    scannedAt: new Date().toISOString(),
    baseUrl: 'https://example.com',
    pagesSkipped: 0,
    budgetExceeded: false,
    ...partial,
  };
}

test('computeCoverageScore is 100 when all discovered routes were scanned', () => {
  assert.equal(computeCoverageScore(routesInv({ routes: [{ path: '/' } as Route], pagesSkipped: 0 })), 100);
});

test('computeCoverageScore is proportional when some routes were skipped', () => {
  assert.equal(
    computeCoverageScore(
      routesInv({
        routes: [{ path: '/a' } as Route, { path: '/b' } as Route, { path: '/c' } as Route],
        pagesSkipped: 7,
      })
    ),
    30
  );
});

test('computeCoverageScore is 0 when nothing was scanned and nothing skipped', () => {
  assert.equal(computeCoverageScore(routesInv({ routes: [], pagesSkipped: 0 })), 0);
});

test('computeQualityScoreFromGaps is 100 for no gaps', () => {
  assert.equal(computeQualityScoreFromGaps([]), 100);
});

test('computeQualityScoreFromGaps reflects high-severity weighting', () => {
  const g: Gap[] = [{ id: '1', path: '/', severity: 'high', reason: 'x', category: 'console-error' }];
  assert.equal(computeQualityScoreFromGaps(g), 80);
});

test('computeQualityScoreFromGaps penalizes critical findings', () => {
  const g: Gap[] = [{ id: '1', path: '/', severity: 'critical', reason: 'c', category: 'a11y' }];
  assert.equal(computeQualityScoreFromGaps(g), 75);
});
