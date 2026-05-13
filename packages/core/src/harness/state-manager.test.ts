import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { resolveReportDir, resolveScanStateBaseDir } from './state-manager.js';

test('resolveReportDir defaults to <cwd>/output when outputDir is unset', () => {
  assert.equal(resolveReportDir(undefined), join(process.cwd(), 'output'));
  assert.equal(resolveReportDir(''), join(process.cwd(), 'output'));
});

test('resolveReportDir respects an absolute config.outputDir', () => {
  const abs = '/tmp/qulib-test-out';
  assert.equal(resolveReportDir(abs), resolve(abs));
});

test('resolveReportDir resolves a relative outputDir against cwd', () => {
  assert.equal(resolveReportDir('reports/q'), resolve(process.cwd(), 'reports/q'));
});

test('resolveScanStateBaseDir and resolveReportDir return distinct defaults', () => {
  assert.notEqual(resolveScanStateBaseDir(undefined), resolveReportDir(undefined));
  assert.match(resolveScanStateBaseDir(undefined), /\.scan-state$/);
  assert.match(resolveReportDir(undefined), /output$/);
});

test('when outputDir is set, scan state and reports share that directory', () => {
  // Behavior contract: outputDir is a single directory; state files and report files
  // have non-overlapping names (discovered-routes.json, decision-log.json, repo-inventory.json,
  // gap-analysis.json vs report.json, report.md) so sharing the directory is safe.
  const abs = '/tmp/qulib-shared-out';
  assert.equal(resolveScanStateBaseDir(abs), resolve(abs));
  assert.equal(resolveReportDir(abs), resolve(abs));
});
