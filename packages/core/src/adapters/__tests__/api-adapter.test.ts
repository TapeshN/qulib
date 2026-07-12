import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { ApiAdapter } from '../api-adapter.js';
import type { NeutralScenario } from '../../schemas/gap-analysis.schema.js';
import type { ApiSurface, DiscoveredEndpoint } from '../../tools/repo/api-surface.js';

const adapter = new ApiAdapter();

function baseSurface(endpoints: DiscoveredEndpoint[], repoPath = '/tmp/fake-repo'): ApiSurface {
  return {
    discoveredAt: new Date().toISOString(),
    repoPath,
    endpoints,
    openApiSpecsFound: 0,
    tier3Enabled: false,
  };
}

function ep(
  method: DiscoveredEndpoint['method'],
  path: string,
  tier: DiscoveredEndpoint['sourceTier'] = 'framework'
): DiscoveredEndpoint {
  return {
    method,
    path,
    sourceFile: 'app/api/test/route.ts',
    sourceTier: tier,
    confidence: 'high',
  };
}

const apiCallScenario: NeutralScenario = {
  id: 'scn-api-001',
  title: 'Health endpoint',
  description: 'Health endpoint returns 200',
  targetPath: '/api/health',
  steps: [
    { action: 'api-call', target: '/api/health', description: 'call the health endpoint' },
  ],
  tags: ['api'],
  recommendations: [],
  sourceGapIds: [],
};

// ---------------------------------------------------------------------------
// render() — NeutralScenario → supertest spec
// ---------------------------------------------------------------------------

test('adapterType is "api"', () => {
  assert.equal(adapter.adapterType, 'api');
});

test('render: metadata uses api adapter and template source', () => {
  const result = adapter.render(apiCallScenario);
  assert.equal(result.adapter, 'api');
  assert.equal(result.source, 'template');
  assert.equal(result.scenarioId, 'scn-api-001');
  assert.ok(result.filename.endsWith('.api.test.ts'), `unexpected filename: ${result.filename}`);
  assert.ok(result.outputPath.startsWith('tests/api/'), `unexpected outputPath: ${result.outputPath}`);
});

test('render: generated code imports supertest and vitest', () => {
  const { code } = adapter.render(apiCallScenario);
  assert.ok(code.includes("import request from 'supertest'"), 'must import supertest');
  assert.ok(code.includes("from 'vitest'"), 'must import from vitest');
});

test('render: api-call step generates a supertest GET call', () => {
  const { code } = adapter.render(apiCallScenario);
  assert.ok(
    code.includes('request(app).get("/api/health")'),
    `expected request(app).get("/api/health") in code, got:\n${code}`
  );
  assert.ok(code.includes('.toBe(200)'), 'should assert status 200 for api-call step');
});

test('render: navigate step generates a GET with status < 500', () => {
  const scenario: NeutralScenario = {
    ...apiCallScenario,
    id: 'scn-nav-001',
    steps: [{ action: 'navigate', target: '/dashboard', description: 'navigate to dashboard' }],
  };
  const { code } = adapter.render(scenario);
  assert.ok(code.includes('request(app).get("/dashboard")'), 'must generate GET for navigate');
  assert.ok(code.includes('.toBeLessThan(500)'), 'navigate should assert < 500');
});

test('render: unknown step action becomes a TODO comment', () => {
  const scenario: NeutralScenario = {
    ...apiCallScenario,
    id: 'scn-todo-001',
    steps: [{ action: 'click', target: '#btn', description: 'click something' }],
  };
  const { code } = adapter.render(scenario);
  assert.ok(code.includes('// TODO (click):'), 'non-api steps should become TODO comments');
});

test('render: empty steps yields placeholder comment', () => {
  const scenario: NeutralScenario = {
    ...apiCallScenario,
    id: 'scn-empty-001',
    steps: [],
  };
  const { code } = adapter.render(scenario);
  assert.ok(
    code.includes('// no api-call steps — add assertions for:'),
    'empty steps should produce placeholder'
  );
});

test('renderAll: each scenario becomes its own GeneratedTest', () => {
  const s2: NeutralScenario = {
    ...apiCallScenario,
    id: 'scn-api-002',
    title: 'Create user',
    description: 'POST creates a user',
    targetPath: '/api/users',
    steps: [{ action: 'api-call', target: '/api/users', description: 'POST to users' }],
  };
  const results = adapter.renderAll([apiCallScenario, s2]);
  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.adapter === 'api'));
  assert.ok(results.every((r) => r.source === 'template'));
});

// ---------------------------------------------------------------------------
// scaffoldApiTests() — repo-first generation from ApiSurface
// ---------------------------------------------------------------------------

test('scaffoldApiTests: returns a GeneratedTest with scenarioId qulib-api-scaffold', () => {
  const surface = baseSurface([ep('GET', '/api/users'), ep('POST', '/api/orders')]);
  const result = adapter.scaffoldApiTests(surface);
  assert.equal(result.scenarioId, 'qulib-api-scaffold');
  assert.equal(result.adapter, 'api');
  assert.equal(result.source, 'template');
  assert.equal(result.filename, 'api-scaffold.test.ts');
  assert.equal(result.outputPath, 'tests/api/api-scaffold.test.ts');
});

test('scaffoldApiTests: imports supertest', () => {
  const surface = baseSurface([ep('GET', '/api/ping')]);
  const { code } = adapter.scaffoldApiTests(surface);
  assert.ok(code.includes("import request from 'supertest'"), 'must import supertest');
});

test('scaffoldApiTests: generates one it-block per endpoint', () => {
  const surface = baseSurface([ep('GET', '/api/users'), ep('DELETE', '/api/orders')]);
  const { code } = adapter.scaffoldApiTests(surface);
  assert.ok(code.includes('GET /api/users'), 'should include GET /api/users it block');
  assert.ok(code.includes('DELETE /api/orders'), 'should include DELETE /api/orders it block');
});

test('scaffoldApiTests: GET endpoint uses request.get()', () => {
  const surface = baseSurface([ep('GET', '/api/users')]);
  const { code } = adapter.scaffoldApiTests(surface);
  assert.ok(code.includes('.get("/api/users")'), 'GET should use request.get()');
});

test('scaffoldApiTests: POST endpoint uses request.post() and includes TODO for body', () => {
  const surface = baseSurface([ep('POST', '/api/orders')]);
  const { code } = adapter.scaffoldApiTests(surface);
  assert.ok(code.includes('.post("/api/orders")'), 'POST should use request.post()');
  assert.ok(code.includes('TODO: add request body'), 'POST should include TODO for body');
});

test('scaffoldApiTests: DELETE endpoint uses request.delete()', () => {
  const surface = baseSurface([ep('DELETE', '/api/orders')]);
  const { code } = adapter.scaffoldApiTests(surface);
  assert.ok(code.includes('.delete("/api/orders")'), 'DELETE should use request.delete()');
});

test('scaffoldApiTests: asserts status < 500 for each endpoint', () => {
  const surface = baseSurface([ep('GET', '/api/users'), ep('POST', '/api/orders')]);
  const { code } = adapter.scaffoldApiTests(surface);
  const count = (code.match(/toBeLessThan\(500\)/g) ?? []).length;
  assert.equal(count, 2, 'each endpoint should assert status < 500');
});

test('scaffoldApiTests: includes discovery source comment', () => {
  const surface = baseSurface([ep('GET', '/api/users', 'openapi')]);
  const { code } = adapter.scaffoldApiTests(surface);
  assert.ok(
    code.includes('// Source:') || code.includes('openapi'),
    'should include source tier comment'
  );
});

test('scaffoldApiTests: empty endpoints returns a no-endpoints placeholder', () => {
  const surface = baseSurface([]);
  const { code } = adapter.scaffoldApiTests(surface);
  assert.ok(code.includes('No API endpoints'), 'should explain that no endpoints were found');
});

// ---------------------------------------------------------------------------
// FINDING 2 (round-6) — this adapter interpolated step.description /
// scenario.description / scenario.id / scenario.targetPath directly into
// bare `//` comments, unsanitized — the SAME newline-terminates-comment
// code-injection class round-5 already fixed in cypress-e2e-adapter.ts and
// playwright-adapter.ts, but api-adapter.ts (the THIRD adapter) was
// missed. An embedded CR/LF silently ends the `//` comment early and turns
// the remainder of the source text into LIVE, UNCOMMENTED code in the
// generated spec.
// ---------------------------------------------------------------------------

const INJECTED_MARKER = 'INJECTED_LIVE_CODE_SHOULD_NOT_RUN();';

function assertNoLiveCodeLeak(code: string): void {
  for (const line of code.split('\n')) {
    if (line.includes(INJECTED_MARKER)) {
      assert.ok(line.trim().startsWith('//'), `marker leaked as live, uncommented code on line: "${line}"`);
    }
  }
}

/**
 * Real proof (not just string-matching) that `code` is syntactically valid
 * TypeScript — needed for the scenario.description case specifically,
 * because api-adapter.ts ALSO interpolates the raw (unsanitized)
 * `scenario.description` a second time via `JSON.stringify(...)` in the
 * `it(...)` title — a DISTINCT, already-safe risk class (JSON.stringify
 * escapes a real newline to the two-char `\n` sequence inside the string
 * literal, so it can never desync the file). That second occurrence would
 * make a naive per-line `assertNoLiveCodeLeak` check false-positive, so
 * this test proves compilability instead.
 */
function assertCompiles(code: string): void {
  const result = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
    reportDiagnostics: true,
  });
  const errors = (result.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  const messages = errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
  assert.equal(errors.length, 0, `generated spec has syntax errors:\n${messages.join('\n')}\n--- spec ---\n${code}`);
}

test('render: a step.description containing a newline collapses to ONE safe comment line, no live code leak (api-call step)', () => {
  const scenario: NeutralScenario = {
    ...apiCallScenario,
    id: 'scn-newline-step-desc',
    steps: [
      {
        action: 'api-call',
        target: '/api/health',
        description: `call the health endpoint\n${INJECTED_MARKER}`,
      },
    ],
  };
  const { code } = adapter.render(scenario);
  assert.ok(
    code.includes(`// call the health endpoint ${INJECTED_MARKER}`),
    `expected the newline collapsed into a single safe comment line:\n${code}`
  );
  assertNoLiveCodeLeak(code);
});

test('render: a step.description containing a newline collapses to ONE safe comment line, no live code leak (navigate step)', () => {
  const scenario: NeutralScenario = {
    ...apiCallScenario,
    id: 'scn-newline-step-desc-nav',
    steps: [{ action: 'navigate', target: '/dashboard', description: `navigate to dashboard\n${INJECTED_MARKER}` }],
  };
  const { code } = adapter.render(scenario);
  assert.ok(
    code.includes(`// navigate to dashboard ${INJECTED_MARKER}`),
    `expected the newline collapsed into a single safe comment line:\n${code}`
  );
  assertNoLiveCodeLeak(code);
});

test('render: a step.description containing a newline collapses to ONE safe comment line, no live code leak (TODO fallback for a non-api/navigate step)', () => {
  const scenario: NeutralScenario = {
    ...apiCallScenario,
    id: 'scn-newline-step-desc-todo',
    steps: [{ action: 'click', target: '#btn', description: `click something\n${INJECTED_MARKER}` }],
  };
  const { code } = adapter.render(scenario);
  assert.ok(
    code.includes(`// TODO (click): click something ${INJECTED_MARKER}`),
    `expected the newline collapsed into a single safe comment line:\n${code}`
  );
  assertNoLiveCodeLeak(code);
});

test('render: a scenario.description containing a newline does not break the file-header comment', () => {
  const scenario: NeutralScenario = {
    ...apiCallScenario,
    id: 'scn-newline-scenario-desc',
    description: `top level\n${INJECTED_MARKER}`,
  };
  const { code } = adapter.render(scenario);
  // The file's FIRST line is the raw `// ${scenario.description}` comment —
  // must be the sanitized single-line form, verbatim.
  const [firstLine] = code.split('\n');
  assert.equal(firstLine, `// top level ${INJECTED_MARKER}`, `unexpected header comment line:\n${code}`);
  // `it(JSON.stringify(scenario.description), ...)` ALSO carries the raw
  // (unsanitized) description — legitimately safe (see assertCompiles doc).
  // Prove that with a real compile, not just a string match.
  assert.ok(
    code.includes(`it(${JSON.stringify(scenario.description)}`),
    `expected the JSON.stringify'd it() name in:\n${code}`
  );
  assertCompiles(code);
});

test('render: a scenario.id containing a newline does not break the file-header comment', () => {
  const scenario: NeutralScenario = {
    ...apiCallScenario,
    id: `scn-newline-id\n${INJECTED_MARKER}`,
  };
  const { code } = adapter.render(scenario);
  const lines = code.split('\n');
  assert.equal(
    lines[1],
    `// qulib-generated — scenario: scn-newline-id ${INJECTED_MARKER}`,
    `unexpected scenario-id comment line:\n${code}`
  );
  assertNoLiveCodeLeak(code);
});

test('render: a scenario.targetPath containing a newline does not break the empty-steps placeholder comment', () => {
  const scenario: NeutralScenario = {
    ...apiCallScenario,
    id: 'scn-newline-target-path',
    targetPath: `/x\n${INJECTED_MARKER}`,
    steps: [],
  };
  const { code } = adapter.render(scenario);
  assert.ok(
    code.includes(`// no api-call steps — add assertions for: /x ${INJECTED_MARKER}`),
    `expected the newline collapsed into a single safe comment line:\n${code}`
  );
  assertNoLiveCodeLeak(code);
});

test('scaffoldApiTests: custom appImportPath is used', () => {
  const surface = baseSurface([ep('GET', '/api/health')]);
  const { code } = adapter.scaffoldApiTests(surface, { appImportPath: '../src/server.js' });
  assert.ok(
    code.includes('../src/server.js'),
    `expected custom appImportPath in code, got:\n${code}`
  );
});

test('scaffoldApiTests: Tier2 OpenAPI endpoint surfaces summary as comment', () => {
  const withSummary: DiscoveredEndpoint = {
    method: 'GET',
    path: '/api/ping',
    sourceFile: 'openapi.yaml',
    sourceTier: 'openapi',
    confidence: 'high',
    summary: 'Health check',
  };
  const surface = baseSurface([withSummary]);
  const { code } = adapter.scaffoldApiTests(surface);
  assert.ok(code.includes('Health check'), 'summary should appear in the code as a comment');
});
