/**
 * Tests for the honest LLM-fallback note: warn when the LLM judge was requested
 * with a key present but the result came back deterministic (the call failed);
 * never warn on the legitimate no-key fallback.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { anthropicKeyPresent, noteLlmFallback } from '../llm-fallback-note.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliEntry = resolve(__dirname, '..', 'index.ts');
const FIXTURE_FORKS = resolve(__dirname, '..', '..', '..', 'fixtures', 'forks.jsonl');
const NOTE_RE = /LLM judge requested but the call failed/;

function captureStderr(fn: () => void): string {
  const orig = process.stderr.write.bind(process.stderr);
  let buf = '';
  (process.stderr as unknown as { write: (c: unknown) => boolean }).write = (chunk: unknown) => {
    buf += String(chunk);
    return true;
  };
  try {
    fn();
  } finally {
    process.stderr.write = orig;
  }
  return buf;
}

test('noteLlmFallback warns only when requested-with-key AND it fell back', () => {
  assert.match(captureStderr(() => noteLlmFallback(true, true)), NOTE_RE);
  assert.equal(captureStderr(() => noteLlmFallback(false, true)), ''); // no key → expected fallback
  assert.equal(captureStderr(() => noteLlmFallback(true, false)), ''); // LLM succeeded
  assert.equal(captureStderr(() => noteLlmFallback(false, false)), '');
});

test('anthropicKeyPresent reflects the environment', () => {
  const saved = process.env.ANTHROPIC_API_KEY;
  try {
    process.env.ANTHROPIC_API_KEY = 'sk-x';
    assert.equal(anthropicKeyPresent(), true);
    process.env.ANTHROPIC_API_KEY = '   ';
    assert.equal(anthropicKeyPresent(), false); // whitespace-only is not "present"
    delete process.env.ANTHROPIC_API_KEY;
    assert.equal(anthropicKeyPresent(), false);
  } finally {
    if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = saved;
  }
});

function runCli(
  args: string[],
  env: Record<string, string | undefined> = {}
): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, ['--import', 'tsx/esm', cliEntry, ...args], {
    encoding: 'utf8',
    cwd: resolve(__dirname, '..', '..', '..'),
    maxBuffer: 20 * 1024 * 1024,
    env: { ...process.env, ANTHROPIC_API_KEY: undefined, ...env },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

test('CLI: no key + --enable-llm-judge → NO false fallback note', () => {
  const { stderr } = runCli(['score-decisions', '--forks', FIXTURE_FORKS, '--enable-llm-judge']);
  assert.doesNotMatch(stderr, NOTE_RE);
});

test('CLI: dummy key + --enable-llm-judge → LLM call fails → fallback note on stderr', () => {
  // An invalid key makes the real provider fail (401 / network), so every fork
  // returns deterministic → the note must fire. stdout stays clean of the note.
  const { stdout, stderr } = runCli(['score-decisions', '--forks', FIXTURE_FORKS, '--enable-llm-judge'], {
    ANTHROPIC_API_KEY: 'sk-ant-invalid-dummy-key-for-test',
  });
  assert.match(stderr, NOTE_RE);
  assert.doesNotMatch(stdout, NOTE_RE);
});
