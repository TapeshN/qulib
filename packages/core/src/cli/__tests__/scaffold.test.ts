/**
 * Tests for the `qulib scaffold` CLI (Q2 scaffold-cli subtask).
 *
 * Discipline matches the rest of packages/core: `node:test` + `tsx/esm`, the CLI
 * spawned as a child via `spawnSync` against the offline fixture server (no live
 * network). Assertions are behavioral, not smoke: we prove the generated spec
 * targets a REAL route the crawler discovered, that disk writes land where the
 * scaffold says, that the playwright not-implemented adapter degrades to an
 * honest actionable error, and that argument validation rejects bad input.
 *
 * The "qulib scaffold against the fixture server" suite requires a Playwright
 * Chromium install. On machines where Chromium is absent (or PLAYWRIGHT_SKIP=1
 * is set) that suite is SKIPped — an acknowledged missing dependency, not a
 * failure. The pure-unit and argument-validation tests run unconditionally.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { readFileSync, rmSync, existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { startFixtureServer, type FixtureServerHandle } from '../../__tests__/fixture-server.js';
import { collectScaffoldFiles, enforceSpecValidation, SpecValidationError } from '../scaffold-run.js';
import type { ScaffoldResult } from '../../scaffold-tests.js';
import type { SpecValidationReport } from '../../adapters/validate-specs.js';
import { chromiumAvailable, CHROMIUM_SKIP_REASON } from '../../__tests__/playwright-available.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const corePkgRoot = resolve(__dirname, '..', '..', '..');
const cliEntry = resolve(__dirname, '..', 'index.ts');

interface CliRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

// Force the deterministic template scenario path — no live LLM call from the child.
const CHILD_ENV = { ...process.env, ANTHROPIC_API_KEY: '' };

/**
 * Synchronous CLI run — for tests that do NOT need the in-process fixture server
 * (validation/honesty cases that hit example.com or fail before any network).
 */
function runCliSync(args: string[], cwd: string): CliRun {
  const result = spawnSync(process.execPath, ['--import', 'tsx/esm', cliEntry, ...args], {
    encoding: 'utf8',
    cwd,
    maxBuffer: 30 * 1024 * 1024,
    env: CHILD_ENV,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/**
 * Asynchronous CLI run — REQUIRED for tests that target the in-process fixture
 * server. `spawnSync` would block this process's event loop so the fixture HTTP
 * server could never answer the child's requests (the child would time out on
 * page.goto). Async `spawn` keeps the parent loop free to serve. This mirrors
 * the proven pattern in src/__tests__/cli-smoke-fixture.ts.
 */
function runCliAsync(args: string[], cwd: string): Promise<CliRun> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, ['--import', 'tsx/esm', cliEntry, ...args], {
      cwd,
      env: CHILD_ENV,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => stdoutChunks.push(c));
    child.stderr.on('data', (c: Buffer) => stderrChunks.push(c));

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      rejectPromise(new Error('scaffold CLI run timed out after 120s'));
    }, 120_000);

    child.on('error', (err) => {
      clearTimeout(timer);
      rejectPromise(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({
        status: code,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
      });
    });
  });
}

/** Routes the public fixture exposes; scaffolded specs must target one of these. */
const FIXTURE_ROUTES = ['/', '/about', '/features', '/docs'];

// ---------------------------------------------------------------------------
// Unit: collectScaffoldFiles is a pure flattening of a ScaffoldResult.
// ---------------------------------------------------------------------------

test('collectScaffoldFiles flattens config + support + specs + package.json', () => {
  const result: ScaffoldResult = {
    url: 'https://example.com',
    framework: 'cypress-e2e',
    scenarios: [],
    generatedTests: [
      {
        scenarioId: 's1',
        adapter: 'cypress-e2e',
        filename: 'login.cy.ts',
        code: `describe('login', () => { it('works', () => { cy.visit('/login'); }); });`,
        source: 'template',
        outputPath: 'cypress/e2e/login.cy.ts',
      },
    ],
    projectConfig: {
      configFile: { filename: 'cypress.config.ts', code: 'export default {};' },
      packageJson: { devDependencies: { cypress: '^13.0.0' }, scripts: { test: 'cypress run' } },
      supportFiles: [{ filename: 'cypress/support/e2e.ts', code: '// support' }],
    },
    specValidation: { ok: true, total: 1, invalidCount: 0, results: [] },
  };

  const files = collectScaffoldFiles(result);
  const byPath = new Map(files.map((f) => [f.relativePath, f.contents]));

  assert.ok(byPath.has('cypress.config.ts'), 'config file must be emitted');
  assert.ok(byPath.has('cypress/support/e2e.ts'), 'support file must be emitted');
  assert.ok(byPath.has('cypress/e2e/login.cy.ts'), 'spec must be emitted at its outputPath');
  assert.ok(byPath.has('package.json'), 'a package.json must be emitted so the scaffold is runnable');

  const pkg = JSON.parse(byPath.get('package.json')!) as {
    scripts: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  assert.equal(pkg.scripts.test, 'cypress run', 'package.json carries the framework test script');
  assert.equal(pkg.devDependencies.cypress, '^13.0.0', 'package.json carries the framework devDeps');
  // Exactly: 1 config + 1 support + 1 spec + 1 package.json
  assert.equal(files.length, 4, `expected 4 flattened files, got ${files.length}`);
});

// ---------------------------------------------------------------------------
// Dry-run gate: enforceSpecValidation throws on a failing report only when
// --validate-specs is set, and is a no-op (returns null) on a clean report.
// This is the fatal-path discrimination witness — runScaffold cannot emit a
// broken spec on demand (adapters always render valid code), so the gate is
// proven directly against an ok:false report.
// ---------------------------------------------------------------------------

const FAILING_REPORT: SpecValidationReport = {
  ok: false,
  total: 2,
  invalidCount: 1,
  results: [
    { scenarioId: 's-ok', filename: 'a.cy.ts', outputPath: 'cypress/e2e/a.cy.ts', valid: true, errors: [] },
    {
      scenarioId: 's-bad',
      filename: 'b.cy.ts',
      outputPath: 'cypress/e2e/b.cy.ts',
      valid: false,
      errors: ["'}' expected."],
    },
  ],
};

const CLEAN_REPORT: SpecValidationReport = {
  ok: true,
  total: 2,
  invalidCount: 0,
  results: [
    { scenarioId: 's1', filename: 'a.cy.ts', outputPath: 'cypress/e2e/a.cy.ts', valid: true, errors: [] },
    { scenarioId: 's2', filename: 'b.cy.ts', outputPath: 'cypress/e2e/b.cy.ts', valid: true, errors: [] },
  ],
};

test('enforceSpecValidation THROWS SpecValidationError on a failing report when --validate-specs is set', () => {
  assert.throws(
    () => enforceSpecValidation(FAILING_REPORT, true),
    (err: unknown) => {
      assert.ok(err instanceof SpecValidationError, 'must be a SpecValidationError');
      assert.equal(err.exitCode, 1, 'must carry a non-zero exit code');
      assert.match(err.message, /failed dry-run validation/i);
      assert.match(err.message, /cypress\/e2e\/b\.cy\.ts/, 'message names the broken spec');
      return true;
    }
  );
});

test('enforceSpecValidation WARNS (returns string, no throw) on a failing report without --validate-specs', () => {
  const warning = enforceSpecValidation(FAILING_REPORT, false);
  assert.ok(typeof warning === 'string' && warning.length > 0, 'returns a warning string, does not throw');
  assert.match(warning, /1 of 2 generated spec/);
});

test('enforceSpecValidation is a no-op (returns null, never throws) on a clean report', () => {
  assert.equal(enforceSpecValidation(CLEAN_REPORT, true), null, 'clean + fatal: no throw, returns null');
  assert.equal(enforceSpecValidation(CLEAN_REPORT, false), null, 'clean + non-fatal: returns null');
});

// ---------------------------------------------------------------------------
// Behavioral: spawn the CLI against the offline fixture server.
// Requires Playwright Chromium — skipped when the binary is absent.
// ---------------------------------------------------------------------------

test(
  'qulib scaffold against the fixture server',
  { skip: chromiumAvailable ? false : CHROMIUM_SKIP_REASON },
  async (t) => {
  let handle: FixtureServerHandle | undefined;

  t.before(async () => {
    handle = await startFixtureServer();
  });

  t.after(async () => {
    if (handle) await handle.close();
  });

  await t.test('--json emits a non-empty scaffold whose spec targets a real discovered route', async () => {
    assert.ok(handle, 'fixture server must be started');
    const run = await runCliAsync(
      ['scaffold', '--url', `${handle.baseUrl}/`, '--json', '--max-pages', '4'],
      corePkgRoot
    );
    assert.equal(run.status, 0, `CLI exited ${run.status}, stderr: ${run.stderr}`);

    const payload = JSON.parse(run.stdout) as {
      url: string;
      framework: string;
      empty: boolean;
      scenarioCount: number;
      generatedTestCount: number;
      scenarios: Array<{ targetPath: string }>;
      generatedTests: Array<{ outputPath: string; code: string; adapter: string }>;
      projectConfig: { configFile: { filename: string; code: string } };
    };

    assert.equal(payload.empty, false, 'public fixture must yield a non-empty scaffold');
    assert.equal(payload.framework, 'cypress-e2e', 'default framework is cypress-e2e');
    assert.ok(payload.scenarioCount > 0, 'must derive at least one scenario');
    assert.equal(
      payload.generatedTestCount,
      payload.generatedTests.length,
      'reported count must match the array length'
    );

    // Every derived scenario must target a route the crawler actually found —
    // not a hallucinated path. This is the "real selectors / real routes" gate.
    for (const scenario of payload.scenarios) {
      assert.ok(
        FIXTURE_ROUTES.includes(scenario.targetPath),
        `scenario targetPath "${scenario.targetPath}" must be a real fixture route`
      );
    }

    // The generated cypress spec must be a real cypress spec that visits a real
    // route and carries an assertion — not an empty-but-confident shell.
    const firstSpec = payload.generatedTests[0];
    assert.ok(firstSpec, 'must generate at least one spec');
    assert.equal(firstSpec.adapter, 'cypress-e2e');
    assert.match(firstSpec.outputPath, /^cypress\/e2e\/.+\.cy\.ts$/, 'spec lands under cypress/e2e');
    assert.match(firstSpec.code, /describe\(/, 'spec has a describe block');
    assert.match(firstSpec.code, /cy\.visit\(/, 'spec visits a route');
    assert.match(firstSpec.code, /cy\.get\([^)]+\)\.should\(/, 'spec carries a real cy assertion');
    // The visited URL inside the spec must be one of the real fixture routes.
    const visited = [...firstSpec.code.matchAll(/cy\.visit\("([^"]+)"\)/g)].map((m) => m[1]);
    assert.ok(visited.length > 0, 'spec must contain at least one cy.visit target');
    for (const v of visited) {
      assert.ok(FIXTURE_ROUTES.includes(v), `cy.visit target "${v}" must be a real fixture route`);
    }

    // The scaffolded cypress config must point baseUrl at the app we scanned.
    assert.match(
      payload.projectConfig.configFile.code,
      new RegExp(`baseUrl:\\s*"${handle!.baseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/?"`),
      'cypress config baseUrl must be the analyzed app URL'
    );
  });

  await t.test('--out writes a runnable scaffold project to disk targeting real routes', async () => {
    assert.ok(handle, 'fixture server must be started');
    const outDir = mkdtempSync(join(tmpdir(), 'qulib-scaffold-out-'));
    try {
      const run = await runCliAsync(
        ['scaffold', '--url', `${handle.baseUrl}/`, '--out', outDir, '--max-pages', '4'],
        corePkgRoot
      );
      assert.equal(run.status, 0, `CLI exited ${run.status}, stderr: ${run.stderr}`);
      // Human-facing progress goes to stderr; stdout stays clean in write mode.
      assert.match(run.stderr, /Scaffold complete/i, 'should report completion on stderr');

      // The framework config must exist with the fixture baseUrl baked in.
      const cypressConfigPath = join(outDir, 'cypress.config.ts');
      assert.ok(existsSync(cypressConfigPath), 'cypress.config.ts must be written');
      const cfg = readFileSync(cypressConfigPath, 'utf8');
      assert.ok(cfg.includes(handle!.baseUrl), 'config baseUrl must be the analyzed app URL');

      // A runnable package.json must exist with the cypress test script.
      const pkgPath = join(outDir, 'package.json');
      assert.ok(existsSync(pkgPath), 'package.json must be written');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
        scripts: Record<string, string>;
        devDependencies: Record<string, string>;
      };
      assert.equal(pkg.scripts.test, 'cypress run');
      assert.ok('cypress' in pkg.devDependencies, 'cypress must be a devDependency');

      // The support file the cypress config references must exist.
      assert.ok(existsSync(join(outDir, 'cypress', 'support', 'e2e.ts')), 'support file must be written');

      // At least one generated spec must exist, target a real route, and assert.
      const specsDir = join(outDir, 'cypress', 'e2e');
      assert.ok(existsSync(specsDir), 'cypress/e2e dir must be written');
      const specFiles = readdirSync(specsDir).filter((f: string) => f.endsWith('.cy.ts'));
      assert.ok(specFiles.length > 0, 'at least one .cy.ts spec must be written');
      const specBody = readFileSync(join(specsDir, specFiles[0]!), 'utf8');
      assert.match(specBody, /cy\.visit\(/, 'written spec visits a route');
      const visited = [...specBody.matchAll(/cy\.visit\("([^"]+)"\)/g)].map((m) => m[1]);
      for (const v of visited) {
        assert.ok(FIXTURE_ROUTES.includes(v), `written spec cy.visit "${v}" must be a real fixture route`);
      }
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  await t.test('--validate-specs passes (exit 0) when the generated specs all parse', async () => {
    assert.ok(handle, 'fixture server must be started');
    const run = await runCliAsync(
      ['scaffold', '--url', `${handle.baseUrl}/`, '--json', '--validate-specs', '--max-pages', '4'],
      corePkgRoot
    );
    assert.equal(run.status, 0, `clean scaffold + --validate-specs must exit 0, stderr: ${run.stderr}`);
    const payload = JSON.parse(run.stdout) as {
      generatedTestCount: number;
      specValidation: { ok: boolean; total: number; invalidCount: number };
    };
    assert.ok(payload.specValidation, 'JSON payload must carry the specValidation report');
    assert.equal(payload.specValidation.ok, true, 'all real adapter specs must pass dry-run validation');
    assert.equal(payload.specValidation.invalidCount, 0);
    assert.equal(
      payload.specValidation.total,
      payload.generatedTestCount,
      'every generated spec must have been validated'
    );
  });

  await t.test('--framework playwright scaffolds valid Playwright tests', async () => {
    // PlaywrightAdapter is now fully implemented. Verify it generates valid output
    // (exit 0, JSON payload, at least one test with Playwright import syntax).
    assert.ok(handle, 'fixture server must be started');
    const run = await runCliAsync(
      ['scaffold', '--url', `${handle.baseUrl}/`, '--framework', 'playwright', '--json', '--max-pages', '4'],
      corePkgRoot
    );
    assert.equal(run.status, 0, `expected exit 0, stderr: ${run.stderr}`);
    const payload = JSON.parse(run.stdout) as Record<string, unknown>;
    assert.strictEqual(payload.framework, 'playwright', 'framework must be playwright');
    assert.ok(
      (payload.generatedTestCount as number) > 0,
      `expected at least 1 generated test, got ${payload.generatedTestCount}`
    );
    assert.doesNotMatch(run.stderr, /at PlaywrightAdapter/, 'must not leak a raw stack trace frame');
  });
},
);

// ---------------------------------------------------------------------------
// Validation: loud on bad input. These fail BEFORE any network call (arg parse
// / zod url parse), so a synchronous spawn is fine — no fixture server needed.
// ---------------------------------------------------------------------------

test('qulib scaffold rejects an unsupported --framework', () => {
  const run = runCliSync(['scaffold', '--url', 'https://example.com', '--framework', 'jest'], corePkgRoot);
  assert.notEqual(run.status, 0, `expected non-zero exit, stdout: ${run.stdout}`);
  assert.match(run.stderr, /Invalid --framework/i);
});

test('qulib scaffold rejects a non-positive --max-pages', () => {
  const run = runCliSync(
    ['scaffold', '--url', 'https://example.com', '--max-pages', '0', '--json'],
    corePkgRoot
  );
  assert.notEqual(run.status, 0, `expected non-zero exit, stdout: ${run.stdout}`);
  assert.match(run.stderr, /--max-pages must be a positive integer/i);
});

test('qulib scaffold rejects a malformed --url', () => {
  const run = runCliSync(['scaffold', '--url', 'not-a-url', '--json'], corePkgRoot);
  assert.notEqual(run.status, 0, `expected non-zero exit, stdout: ${run.stdout}`);
  // zod's url parse failure surfaces through the CLI's top-level error handler.
  assert.match(run.stderr, /\[qulib\] Failed:/i);
});
