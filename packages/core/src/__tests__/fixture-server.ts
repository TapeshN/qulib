/**
 * Deterministic Node.js fixture server for offline Qulib integration tests.
 *
 * Serves the static HTML files in `packages/core/fixtures/` over loopback so
 * the test suite never depends on a live website. Used by
 * `analyze.fixtures.test.ts` and any future offline integration coverage.
 *
 * Never imported by product code. Helpers are private to this module; only
 * `startFixtureServer` and `FixtureServerHandle` are exported.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface FixtureServerHandle {
  baseUrl: string;
  close: () => Promise<void>;
}

const HTML_CONTENT_TYPE = 'text/html; charset=utf-8';
const TEXT_CONTENT_TYPE = 'text/plain; charset=utf-8';

function resolveFixturesDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '../../fixtures');
}

function routeToFile(pathname: string): string | null {
  if (pathname.includes('..')) return null;

  const fixturesDir = resolveFixturesDir();

  if (pathname === '/' || pathname === '/index.html') {
    return join(fixturesDir, 'public/index.html');
  }
  if (pathname === '/about') {
    return join(fixturesDir, 'public/about.html');
  }
  if (pathname === '/features') {
    return join(fixturesDir, 'public/features.html');
  }
  if (pathname === '/docs') {
    return join(fixturesDir, 'public/index.html');
  }
  if (pathname === '/auth') {
    return join(fixturesDir, 'auth-wall/index.html');
  }
  if (pathname === '/authenticated' || pathname.startsWith('/authenticated/')) {
    return join(fixturesDir, 'authenticated/index.html');
  }
  if (pathname === '/broken') {
    return join(fixturesDir, 'broken/index.html');
  }
  return null;
}

async function readFixture(filePath: string): Promise<Buffer> {
  return readFile(filePath);
}

function respond(
  res: ServerResponse,
  status: number,
  body: Buffer | string,
  contentType: string
): void {
  const buf = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
  });
  res.end(buf);
}

function respondNotFound(res: ServerResponse): void {
  respond(res, 404, 'Not found', TEXT_CONTENT_TYPE);
}

function respondServerError(res: ServerResponse, message: string): void {
  respond(res, 500, `Fixture server error: ${message}`, TEXT_CONTENT_TYPE);
}

function respondMethodNotAllowed(res: ServerResponse): void {
  res.writeHead(405, {
    Allow: 'GET',
    'Content-Type': TEXT_CONTENT_TYPE,
    'Cache-Control': 'no-store',
  });
  res.end('Method Not Allowed');
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    if (req.method !== 'GET') {
      respondMethodNotAllowed(res);
      return;
    }

    const rawUrl = req.url ?? '/';
    let pathname: string;
    try {
      pathname = new URL(rawUrl, 'http://127.0.0.1').pathname;
    } catch {
      respondNotFound(res);
      return;
    }

    const filePath = routeToFile(pathname);
    if (filePath === null) {
      respondNotFound(res);
      return;
    }

    const body = await readFixture(filePath);
    respond(res, 200, body, HTML_CONTENT_TYPE);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    respondServerError(res, message);
  }
}

export async function startFixtureServer(): Promise<FixtureServerHandle> {
  const fixturesDir = resolveFixturesDir();
  try {
    const s = await stat(fixturesDir);
    if (!s.isDirectory()) {
      throw new Error(`fixtures path is not a directory: ${fixturesDir}`);
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Fixture directory not found at ${fixturesDir}: ${detail}`);
  }

  const server = createServer((req, res) => {
    void handleRequest(req, res);
  });

  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', rejectPromise);
      resolvePromise();
    });
  });

  const address = server.address();
  if (address === null || typeof address === 'string') {
    server.close();
    throw new Error('Fixture server did not return a usable address after listen');
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    close: () =>
      new Promise<void>((resolvePromise, rejectPromise) => {
        server.close((err) => {
          if (err) rejectPromise(err);
          else resolvePromise();
        });
      }),
  };
}
