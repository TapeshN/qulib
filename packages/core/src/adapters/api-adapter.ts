import type { TestAdapter } from './adapter.interface.js';
import type { NeutralScenario, GeneratedTest } from '../schemas/gap-analysis.schema.js';
import type { DiscoveredEndpoint, ApiSurface } from '../tools/repo/api-surface.js';

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
            `    // ${step.description}`,
            `    const res = await request(app).get(${JSON.stringify(path)});`,
            `    expect(res.status).toBe(200);`,
          ].join('\n');
        }
        if (step.action === 'navigate') {
          const path = step.target ?? step.value ?? '/';
          return [
            `    // ${step.description}`,
            `    const res = await request(app).get(${JSON.stringify(path)});`,
            `    expect(res.status).toBeLessThan(500);`,
          ].join('\n');
        }
        return `    // TODO (${step.action}): ${step.description}`;
      })
      .join('\n');

    const code = [
      `// ${scenario.description}`,
      `// qulib-generated — scenario: ${scenario.id}`,
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
      stepLines || `    // no api-call steps — add assertions for: ${scenario.targetPath}`,
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
        `// qulib-generated — repo: ${apiSurface.repoPath}`,
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
      `// qulib-generated — repo: ${apiSurface.repoPath}`,
      `// Discovery tier breakdown: ${describeDiscoveryTiers(endpoints)}`,
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
  const sourceLine = `  // Source: ${ep.sourceFile} (${ep.sourceTier}, confidence: ${ep.confidence})`;
  const itTitle = `${method} ${ep.path}`;

  const requestLine = hasBody
    ? `      const res = await request(app).${methodLower}(${JSON.stringify(ep.path)});\n      // TODO: add request body — e.g. .send({ ... })`
    : `      const res = await request(app).${methodLower}(${JSON.stringify(ep.path)});`;

  const summaryLine = ep.summary ? `  // ${ep.summary}\n` : '';

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
