/**
 * Offline CLI smoke: spawn `node bin/qulib.js analyze --url <fixture>` against
 * the local fixture server and assert the CLI exited 0. Runnable script (not a
 * node:test file) — invoked in CI by `node --import tsx/esm src/__tests__/cli-smoke-fixture.ts`.
 *
 * Removes the live `https://example.com` dependency from CI's smoke-test-cli job.
 *
 * The fixture server runs in this process; the CLI is spawned as a child. We use
 * async `spawn` (not `spawnSync`) so the parent event loop stays free to serve
 * the child's HTTP requests against the fixture.
 */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixtureServer } from './fixture-server.js';

interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const __dir = dirname(fileURLToPath(import.meta.url));
const cliPath = resolve(__dir, '../../bin/qulib.js');

function runCli(url: string): Promise<CliResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('node', [cliPath, 'analyze', '--url', url, '--ephemeral'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      rejectPromise(new Error('CLI smoke timed out after 120s'));
    }, 120_000);

    child.on('error', (err) => {
      clearTimeout(timer);
      rejectPromise(err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({
        exitCode: code ?? -1,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
      });
    });
  });
}

function assertCliPassed(result: CliResult): void {
  if (result.exitCode !== 0) {
    throw new Error(
      `CLI exited with code ${result.exitCode}\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`
    );
  }
}

const handle = await startFixtureServer();
try {
  const result = await runCli(`${handle.baseUrl}/`);
  assertCliPassed(result);
  console.log('[cli-smoke] ✔ CLI exited 0 against fixture public surface');
} finally {
  await handle.close();
}
