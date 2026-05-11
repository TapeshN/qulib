import { readFile } from 'node:fs/promises';
import { relative, basename } from 'node:path';
import glob from 'fast-glob';
import { RepoAnalysisSchema, type RepoAnalysis } from '../schemas/repo-analysis.schema.js';

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
  for (const file of tsxFiles) {
    const rel = toPosix(relative(repoPath, file));
    const content = await readFile(file, 'utf8');
    const hasInteractive = content.includes('<button') || content.includes('<input') || content.includes('<a ');
    if (hasInteractive && !content.includes('data-testid')) {
      missingTestIds.push(rel);
    }
  }

  return RepoAnalysisSchema.parse({
    scannedAt: new Date().toISOString(),
    repoPath,
    routes,
    testFiles,
    missingTestIds: [...new Set(missingTestIds)],
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
  });
}
