import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const corePkgRoot = resolve(__dirname, '..', '..');
const cliEntry = resolve(__dirname, '..', 'cli', 'index.ts');

function runCli(args: string[], cwd: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ['--import', 'tsx/esm', cliEntry, ...args], {
    encoding: 'utf8',
    cwd,
    maxBuffer: 20 * 1024 * 1024,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test('analyze rejects --agent-summary together with --ephemeral', () => {
  const { status, stderr } = runCli(
    ['analyze', '--url', 'https://example.com', '--agent-summary', '--ephemeral'],
    corePkgRoot
  );
  assert.notEqual(status, 0, `expected failure, stderr: ${stderr}`);
  assert.match(stderr, /Use either --agent-summary or --ephemeral/i);
});
