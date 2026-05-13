/**
 * @module repo-scanner
 * @packageBoundary @qulib/core (candidate: @qulib/analyzer)
 *
 * This module performs static analysis of a repository's file structure.
 * It is currently embedded in @qulib/core because repo scanning is part of
 * the observe phase and @qulib/core is the only consumer.
 *
 * Extraction to @qulib/analyzer is appropriate when:
 *   1. A consumer needs repo analysis without URL crawling
 *   2. The module grows to include PRD/Jira/Confluence ingestion
 *   3. A standalone CLI command `qulib analyze-repo` is needed
 *
 * Before extraction: ensure RepoAnalysis schema is re-exported from @qulib/analyzer
 * and @qulib/core depends on @qulib/analyzer (not the reverse).
 */

import { readFile } from 'node:fs/promises';
import { relative, basename } from 'node:path';
import glob from 'fast-glob';
import { RepoAnalysisSchema, type RepoAnalysis } from '../schemas/repo-analysis.schema.js';
import { detectFramework } from './framework-detector.js';
import { computeAutomationMaturity } from './automation-maturity.js';

const IGNORE_PATTERNS = ['**/node_modules/**', '**/.next/**', '**/dist/**', '**/build/**'];

function toPosix(path: string): string {
  return path.split('\\').join('/');
}

function normalizeRoutePath(path: string): string {
  const normalized = `/${path}`.replace(/\/+/g, '/').replace(/\/$/, '');
  return normalized === '' ? '/' : normalized;
}

function detectTestType(filePath: string, content: string): RepoAnalysis['testFiles'][number]['type'] {
  const normalizedPath = toPosix(filePath);
  if (normalizedPath.includes('cypress/e2e')) return 'cypress-e2e';
  if (normalizedPath.includes('cypress/component')) return 'cypress-component';
  if (
    (normalizedPath.includes('playwright') || normalizedPath.includes('e2e')) &&
    normalizedPath.endsWith('.spec.ts')
  ) {
    return 'playwright';
  }
  if (/\bfrom\s+['"]vitest['"]|\brequire\(['"]vitest['"]\)/.test(content)) return 'vitest';
  if (/\bfrom\s+['"]jest['"]|\brequire\(['"]jest['"]\)/.test(content)) return 'jest';
  return 'other';
}

function extractCoveredPaths(content: string): string[] {
  const matches = [...content.matchAll(/['"`](\/[a-zA-Z0-9\/_\-\[\]]+)['"`]/g)].map((m) => m[1]);
  return [...new Set(matches)];
}

export async function scanRepo(repoPath: string): Promise<RepoAnalysis> {
  const routes: RepoAnalysis['routes'] = [];

  const appRouterFiles = await glob(['app/**/page.tsx', 'app/**/page.ts'], {
    cwd: repoPath,
    onlyFiles: true,
    absolute: true,
    ignore: IGNORE_PATTERNS,
  });
  for (const file of appRouterFiles) {
    const rel = toPosix(relative(repoPath, file));
    const routeSegment = rel.replace(/^app\//, '').replace(/\/page\.tsx?$/, '');
    const routePath = normalizeRoutePath(routeSegment);
    routes.push({ path: routePath, file: rel, method: 'GET' });
  }

  const pagesRouterFiles = await glob(['pages/**/*.tsx', 'pages/**/*.ts'], {
    cwd: repoPath,
    onlyFiles: true,
    absolute: true,
    ignore: IGNORE_PATTERNS,
  });
  for (const file of pagesRouterFiles) {
    const rel = toPosix(relative(repoPath, file));
    const name = basename(rel);
    if (name.startsWith('_')) continue;
    const routeSegment = rel.replace(/^pages\//, '').replace(/\.tsx?$/, '');
    const routePath =
      routeSegment === 'index'
        ? '/'
        : normalizeRoutePath(routeSegment.replace(/\/index$/, ''));
    routes.push({ path: routePath, file: rel, method: 'GET' });
  }

  const expressFiles = await glob(['src/**/*.ts', 'src/**/*.js'], {
    cwd: repoPath,
    onlyFiles: true,
    absolute: true,
    ignore: IGNORE_PATTERNS,
  });
  for (const file of expressFiles) {
    const rel = toPosix(relative(repoPath, file));
    const content = await readFile(file, 'utf8');
    const routeRegex = /router\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)/gi;
    for (const match of content.matchAll(routeRegex)) {
      const method = match[1]?.toUpperCase() as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
      const routePath = normalizeRoutePath(match[2] ?? '/');
      routes.push({ path: routePath, file: rel, method });
    }
  }

  const testFilePaths = await glob(
    [
      '**/*.spec.ts',
      '**/*.test.ts',
      '**/*.spec.tsx',
      '**/*.test.tsx',
      '**/cypress/e2e/**/*.ts',
      '**/cypress/e2e/**/*.cy.ts',
    ],
    {
      cwd: repoPath,
      onlyFiles: true,
      absolute: true,
      ignore: IGNORE_PATTERNS,
    }
  );
  const testFiles: RepoAnalysis['testFiles'] = [];
  for (const file of [...new Set(testFilePaths)]) {
    const rel = toPosix(relative(repoPath, file));
    const content = await readFile(file, 'utf8');
    testFiles.push({
      file: rel,
      type: detectTestType(rel, content),
      coveredPaths: extractCoveredPaths(content),
    });
  }

  const cypressRoot = await glob(['cypress'], { cwd: repoPath, onlyDirectories: true, absolute: false, deep: 1 });
  const e2eFolder = await glob(['cypress/e2e'], { cwd: repoPath, onlyDirectories: true, absolute: false, deep: 1 });
  const componentFolder = await glob(['cypress/component'], { cwd: repoPath, onlyDirectories: true, absolute: false, deep: 1 });
  const fixturesFolder = await glob(['cypress/fixtures'], { cwd: repoPath, onlyDirectories: true, absolute: false, deep: 1 });
  const supportFolder = await glob(['cypress/support'], { cwd: repoPath, onlyDirectories: true, absolute: false, deep: 1 });
  const commandsFile = await glob(['cypress/support/commands.ts'], { cwd: repoPath, onlyFiles: true, absolute: false });
  const existingE2eFiles = await glob(['cypress/e2e/**/*.cy.ts'], { cwd: repoPath, onlyFiles: true, absolute: false });
  const existingComponentFiles = await glob(['cypress/component/**/*.cy.tsx'], {
    cwd: repoPath,
    onlyFiles: true,
    absolute: false,
  });

  const tsxFiles = await glob(['**/*.tsx'], {
    cwd: repoPath,
    onlyFiles: true,
    absolute: true,
    ignore: [...IGNORE_PATTERNS, '**/*.spec.tsx'],
  });
  const missingTestIds: string[] = [];
  let interactiveTsxFilesScanned = 0;
  for (const file of tsxFiles) {
    const rel = toPosix(relative(repoPath, file));
    const content = await readFile(file, 'utf8');
    const hasInteractive = content.includes('<button') || content.includes('<input') || content.includes('<a ');
    if (hasInteractive) {
      interactiveTsxFilesScanned += 1;
      if (!content.includes('data-testid')) {
        missingTestIds.push(rel);
      }
    }
  }

  const base: Omit<RepoAnalysis, 'framework' | 'automationMaturity'> = {
    scannedAt: new Date().toISOString(),
    repoPath,
    routes,
    testFiles,
    missingTestIds: [...new Set(missingTestIds)],
    interactiveTsxFilesScanned,
    cypressStructure: {
      detected: cypressRoot.length > 0,
      e2eFolder: e2eFolder[0],
      componentFolder: componentFolder[0],
      fixturesFolder: fixturesFolder[0],
      supportFolder: supportFolder[0],
      hasCommandsFile: commandsFile.length > 0,
      existingE2eFiles,
      existingComponentFiles,
    },
  };

  let parsed = RepoAnalysisSchema.parse(base);

  try {
    const framework = await detectFramework(repoPath);
    parsed = RepoAnalysisSchema.parse({ ...parsed, framework });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`[qulib] framework detection failed for ${repoPath}: ${msg}`);
  }

  const automationMaturity = computeAutomationMaturity(parsed);
  return RepoAnalysisSchema.parse({ ...parsed, automationMaturity });
}
