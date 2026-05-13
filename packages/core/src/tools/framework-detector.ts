/**
 * @module framework-detector
 * @packageBoundary @qulib/core (candidate: @qulib/analyzer)
 *
 * Framework detection runs during the observe phase as part of repo scanning.
 * It is a pure static analysis operation with no browser or LLM dependency.
 * Move this to @qulib/analyzer when that package is created.
 *
 * // TODO(@qulib/analyzer): When @qulib/analyzer is extracted, this module should move there.
 * // It is currently embedded in @qulib/core because repo scanning is part of the observe phase.
 * // The package boundary decision: core = runtime QA analysis, analyzer = static repo intelligence.
 */

import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { FrameworkDetectionSchema, type FrameworkDetectionResult } from '../schemas/repo-analysis.schema.js';

async function fileExists(repoPath: string, rel: string): Promise<boolean> {
  try {
    await access(join(repoPath, rel), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

type PkgJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

function depNames(pkg: PkgJson): Set<string> {
  return new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ]);
}

export async function detectFramework(repoPath: string): Promise<FrameworkDetectionResult> {
  const evidence: string[] = [];
  const testFrameworks = new Set<FrameworkDetectionResult['testFrameworks'][number]>();

  let pkg: PkgJson = {};
  try {
    const raw = await readFile(join(repoPath, 'package.json'), 'utf8');
    pkg = JSON.parse(raw) as PkgJson;
    evidence.push('read package.json');
  } catch {
    evidence.push('package.json missing or unreadable');
  }

  const deps = depNames(pkg);
  const has = (n: string) => deps.has(n);

  if (has('@playwright/test') || has('playwright')) {
    testFrameworks.add('playwright');
    evidence.push('dependency: @playwright/test or playwright');
  }
  if (has('cypress')) {
    testFrameworks.add('cypress-e2e');
    evidence.push('dependency: cypress');
  }
  if (has('jest')) {
    testFrameworks.add('jest');
    evidence.push('dependency: jest');
  }
  if (has('vitest')) {
    testFrameworks.add('vitest');
    evidence.push('dependency: vitest');
  }
  if (testFrameworks.size === 0) {
    testFrameworks.add('other');
  }

  const nextCfg =
    (await fileExists(repoPath, 'next.config.js')) ||
    (await fileExists(repoPath, 'next.config.mjs')) ||
    (await fileExists(repoPath, 'next.config.ts'));
  const nuxtCfg = await fileExists(repoPath, 'nuxt.config.ts');
  const svelteCfg = await fileExists(repoPath, 'svelte.config.js');
  const astroCfg = await fileExists(repoPath, 'astro.config.mjs');
  const remixCfg = await fileExists(repoPath, 'remix.config.js');
  const viteCfg = await fileExists(repoPath, 'vite.config.ts');

  if (nextCfg) evidence.push('found next.config.*');
  if (nuxtCfg) evidence.push('found nuxt.config.ts');
  if (svelteCfg) evidence.push('found svelte.config.js');
  if (astroCfg) evidence.push('found astro.config.mjs');
  if (remixCfg) evidence.push('found remix.config.js');
  if (viteCfg) evidence.push('found vite.config.ts');

  const hasAppDir = await fileExists(repoPath, 'app');
  const hasPagesDir = await fileExists(repoPath, 'pages');
  if (has('next') && hasAppDir) evidence.push('Next.js app/ directory present');
  if (has('next') && hasPagesDir) evidence.push('Next.js pages/ directory present');
  if (has('@remix-run/react') || has('@remix-run/node')) evidence.push('Remix packages in package.json');
  if (has('nuxt') || has('nuxt3')) evidence.push('Nuxt in package.json');
  if (has('@sveltejs/kit')) evidence.push('@sveltejs/kit in package.json');
  if (has('astro')) evidence.push('astro in package.json');
  if (has('vite') && !has('next')) evidence.push('vite in package.json (non-Next)');

  let primary: FrameworkDetectionResult['primary'] = 'unknown';
  let confidence: FrameworkDetectionResult['confidence'] = 'low';

  if (has('next')) {
    if (hasAppDir && (await fileExists(repoPath, join('app', 'layout.tsx')))) {
      primary = 'nextjs-app-router';
      confidence = nextCfg || hasAppDir ? 'high' : 'medium';
    } else if (hasPagesDir) {
      primary = 'nextjs-pages-router';
      confidence = nextCfg || hasPagesDir ? 'high' : 'medium';
    } else {
      primary = 'nextjs-app-router';
      confidence = 'medium';
      evidence.push('next detected without clear app/ vs pages/ layout');
    }
  } else if (has('@remix-run/react') || remixCfg) {
    primary = 'remix';
    confidence = remixCfg ? 'high' : 'medium';
  } else if (has('nuxt') || nuxtCfg) {
    primary = 'nuxt';
    confidence = nuxtCfg ? 'high' : 'medium';
  } else if (has('@sveltejs/kit') || svelteCfg) {
    primary = 'sveltekit';
    confidence = svelteCfg ? 'high' : 'medium';
  } else if (has('astro') || astroCfg) {
    primary = 'astro';
    confidence = astroCfg ? 'high' : 'medium';
  } else if (viteCfg && !has('next')) {
    primary = 'vite';
    confidence = 'medium';
  } else if (has('express')) {
    primary = 'express';
    confidence = 'medium';
    evidence.push('express listed in dependencies');
  } else {
    /* keep unknown */
  }

  const raw: FrameworkDetectionResult = {
    primary,
    confidence,
    evidence,
    testFrameworks: [...testFrameworks],
  };
  return FrameworkDetectionSchema.parse(raw);
}
