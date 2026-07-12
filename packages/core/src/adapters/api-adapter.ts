import type { TestAdapter } from './adapter.interface.js';
import type { NeutralScenario, GeneratedTest } from '../schemas/gap-analysis.schema.js';
import type { DiscoveredEndpoint, ApiSurface } from '../tools/repo/api-surface.js';
// FINDING 2 (round-6): this adapter interpolated step.description /
// scenario.description / scenario.id / scenario.targetPath / step.action
// directly into bare `//` comments, unsanitized — the SAME newline-
// terminates-comment code-injection class that cypress-e2e-adapter.ts and
// playwright-adapter.ts were already fixed for (round-5). A raw CR/LF (or
// the U+2028/U+2029 line-terminator code points) embedded in any of these
// fields silently ends the `//` comment early and turns the remainder of
// the source text into LIVE, UNCOMMENTED code in the generated spec.
// sanitizeForComment is the ONE choke-point for this — every `//` comment
// interpolation of a scenario/step field in this file must route through
// it. See __tests__/type-and-comment-choke-point-guard.test.ts, which
// fails the build if a future comment site bypasses it.
//
// FINDING 1 (round-7): round-6's fix and its guard both enumerated a fixed
// list of KNOWN field names (scenario.description, step.description, ...).
// `renderEndpointTest`/`scaffoldApiTests` below were untouched by round-6 —
// they interpolate a DIFFERENT set of raw fields (`ep.summary`,
// `ep.sourceFile`, `ep.sourceTier`, `ep.confidence`, `apiSurface.repoPath`)
// into bare `//` comments, and `ep.summary` in particular is raw text lifted
// straight out of a caller-supplied OpenAPI spec's `summary` field — the
// SAME injection class, at a site the name-enumerated guard had no way to
// know about. The round-7 guard (see the test file above) no longer
// enumerates names at all: it fails on ANY unsanitized `${...}` inside a
// `//`-comment template, so a future new field is caught automatically
// without needing a matching update to the guard's field list.
import { sanitizeForComment } from './comment-safety.js';

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * TestAdapter implementation for API testing via supertest.
 *
 * `render` / `renderAll`: convert gap-analysis NeutralScenarios that carry
 *   `api-call` steps into supertest specs. Used by the standard adapter pipeline.
 *
 * `scaffoldApiTests`: separate entry point for the repo-first API toolshed flow.
 *   Accepts discovered endpoints (ApiSurface) and generates a ready-to-run
 *   supertest test file — NOT URL-based.
 */
export class ApiAdapter implements TestAdapter {
  readonly adapterType = 'api';

  render(scenario: NeutralScenario): GeneratedTest {
    const slug = slugify(scenario.title);
    const filename = `${slug}.api.test.ts`;

    const stepLines = scenario.steps
      .map((step) => {
        if (step.action === 'api-call') {
          const path = step.target ?? step.value ?? '/';
          return [
            `    // ${sanitizeForComment(step.description)}`,
            `    const res = await request(app).get(${JSON.stringify(path)});`,
            `    expect(res.status).toBe(200);`,
          ].join('\n');
        }
        if (step.action === 'navigate') {
          const path = step.target ?? step.value ?? '/';
          return [
            `    // ${sanitizeForComment(step.description)}`,
            `    const res = await request(app).get(${JSON.stringify(path)});`,
            `    expect(res.status).toBeLessThan(500);`,
          ].join('\n');
        }
        // ROUND-7: step.action is a closed zod enum (never carries a
        // newline) — round-6's name-enumerated guard deliberately exempted
        // it. The round-7 guard is shape-based and makes no such judgment
        // call, so this now routes through sanitizeForComment(...) too;
        // it's a no-op for an enum value but keeps the rule with zero
        // exceptions to remember.
        return `    // TODO (${sanitizeForComment(step.action)}): ${sanitizeForComment(step.description)}`;
      })
      .join('\n');

    const code = [
      `// ${sanitizeForComment(scenario.description)}`,
      `// qulib-generated — scenario: ${sanitizeForComment(scenario.id)}`,
      ``,
      `import request from 'supertest';`,
      `import { describe, it, expect } from 'vitest';`,
      ``,
      `// TODO: import or create your Express/Fastify/Hono app here`,
      `// import { app } from '../src/app.js';`,
      `declare const app: unknown;`,
      ``,
      `describe(${JSON.stringify(scenario.title)}, () => {`,
      `  it(${JSON.stringify(scenario.description)}, async () => {`,
      stepLines || `    // no api-call steps — add assertions for: ${sanitizeForComment(scenario.targetPath)}`,
      `  });`,
      `});`,
      ``,
    ].join('\n');

    return {
      scenarioId: scenario.id,
      adapter: 'api',
      filename,
      code,
      source: 'template',
      outputPath: `tests/api/${filename}`,
    };
  }

  renderAll(scenarios: NeutralScenario[]): GeneratedTest[] {
    return scenarios.map((s) => this.render(s));
  }

  /**
   * Generate a supertest-based test file from discovered API endpoints.
   * This is the repo-first entry point — does NOT require a running URL.
   *
   * Endpoints are grouped into a single test file. Each endpoint gets one
   * `it` block that:
   *   - Makes the correct HTTP method call
   *   - Asserts status < 500 (smoke-level assertion, safely runnable against a live app)
   *   - POST/PUT/PATCH endpoints include a TODO for request body
   *
   * The file is NOT associated with a NeutralScenario; it uses a fixed scenarioId.
   */
  scaffoldApiTests(
    apiSurface: ApiSurface,
    options: { appImportPath?: string } = {}
  ): GeneratedTest {
    const appImport = options.appImportPath ?? '../src/app.js';
    const endpoints = apiSurface.endpoints;

    if (endpoints.length === 0) {
      const code = [
        `// qulib-generated API scaffold — no endpoints discovered`,
        `// qulib-generated — repo: ${sanitizeForComment(apiSurface.repoPath)}`,
        ``,
        `// No API endpoints were discovered in this repository.`,
        `// If your app has REST endpoints, ensure they are declared in a supported`,
        `// framework (Next.js route.ts, Express, Fastify, NestJS) or an OpenAPI spec.`,
        ``,
      ].join('\n');
      return {
        scenarioId: 'qulib-api-scaffold',
        adapter: 'api',
        filename: 'api-scaffold.test.ts',
        code,
        source: 'template',
        outputPath: 'tests/api/api-scaffold.test.ts',
      };
    }

    const itBlocks = endpoints.map((ep) => renderEndpointTest(ep)).join('\n\n');

    const code = [
      `// qulib-generated API scaffold — ${endpoints.length} endpoint(s) discovered`,
      `// qulib-generated — repo: ${sanitizeForComment(apiSurface.repoPath)}`,
      `// Discovery tier breakdown: ${sanitizeForComment(describeDiscoveryTiers(endpoints))}`,
      ``,
      `import request from 'supertest';`,
      `import { describe, it, expect, beforeAll, afterAll } from 'vitest';`,
      ``,
      `// TODO: replace with your actual app export`,
      `import { app } from ${JSON.stringify(appImport)};`,
      ``,
      `describe('API surface smoke tests (qulib-generated)', () => {`,
      itBlocks,
      `});`,
      ``,
    ].join('\n');

    return {
      scenarioId: 'qulib-api-scaffold',
      adapter: 'api',
      filename: 'api-scaffold.test.ts',
      code,
      source: 'template',
      outputPath: 'tests/api/api-scaffold.test.ts',
    };
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function renderEndpointTest(ep: DiscoveredEndpoint): string {
  const method = ep.method === 'unknown' ? 'GET' : ep.method;
  const methodLower = method.toLowerCase();
  const hasBody = method === 'POST' || method === 'PUT' || method === 'PATCH';
  // FINDING 1 (round-7): ep.sourceFile is a repo-relative path read off disk
  // and ep.summary (below) is raw OpenAPI spec text — both externally
  // derived, both routed through sanitizeForComment before landing in a `//`
  // comment. ep.sourceTier/ep.confidence are closed unions assigned by our
  // own discovery code (never free text), but they're sanitized too — the
  // round-7 guard is shape-based (ANY interpolation in a comment must be
  // sanitizeForComment(...)), not field-name-based, so there is no
  // "known-safe enum, skip it" carve-out to maintain here.
  const sourceLine = `  // Source: ${sanitizeForComment(ep.sourceFile)} (${sanitizeForComment(ep.sourceTier)}, confidence: ${sanitizeForComment(ep.confidence)})`;
  const itTitle = `${method} ${ep.path}`;

  const requestLine = hasBody
    ? `      const res = await request(app).${methodLower}(${JSON.stringify(ep.path)});\n      // TODO: add request body — e.g. .send({ ... })`
    : `      const res = await request(app).${methodLower}(${JSON.stringify(ep.path)});`;

  const summaryLine = ep.summary ? `  // ${sanitizeForComment(ep.summary)}\n` : '';

  return [
    summaryLine + sourceLine,
    `  it(${JSON.stringify(itTitle)}, async () => {`,
    requestLine,
    `      expect(res.status).toBeLessThan(500);`,
    `  });`,
  ].join('\n');
}

function describeDiscoveryTiers(endpoints: DiscoveredEndpoint[]): string {
  const counts = { openapi: 0, framework: 0, heuristic: 0 };
  for (const ep of endpoints) counts[ep.sourceTier]++;
  return Object.entries(counts)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => `${v} ${k}`)
    .join(', ');
}
