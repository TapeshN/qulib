#!/usr/bin/env node
// MCP server smoke test: spawn the built stdio server, perform the JSON-RPC
// initialize handshake, request tools/list, and assert the expected tools are
// advertised. Exits non-zero (failing CI) on any mismatch or timeout.
//
// Intentionally dependency-free (raw stdio JSON-RPC) so it runs against the
// shipped artifact exactly as an MCP host would, without pulling in the SDK.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverEntry = resolve(__dirname, '..', 'dist', 'index.js');

const EXPECTED_TOOLS = ['explore_auth', 'detect_auth', 'analyze_app', 'qulib_score_automation'];
const TIMEOUT_MS = 30_000;

if (!existsSync(serverEntry)) {
  console.error(`[smoke] FAIL: built server not found at ${serverEntry} — run \`npm run build\` first.`);
  process.exit(1);
}

const child = spawn(process.execPath, [serverEntry], {
  stdio: ['pipe', 'pipe', 'inherit'],
  // ANTHROPIC_API_KEY is deliberately unset: listing tools must not require it.
  env: { ...process.env, ANTHROPIC_API_KEY: '' },
});

let buffer = '';
const pending = new Map();

function send(message) {
  child.stdin.write(JSON.stringify(message) + '\n');
}

function fail(msg) {
  console.error(`[smoke] FAIL: ${msg}`);
  child.kill('SIGKILL');
  process.exit(1);
}

const timer = setTimeout(() => fail(`timed out after ${TIMEOUT_MS}ms`), TIMEOUT_MS);

child.on('error', (err) => fail(`failed to spawn server: ${err.message}`));
child.on('exit', (code, signal) => {
  if (!process.exitCode && signal !== 'SIGKILL') {
    fail(`server exited early (code=${code}, signal=${signal})`);
  }
});

child.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  let nl;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue; // non-JSON log line on stdout — ignore.
    }
    if (msg.id != null && pending.has(msg.id)) {
      const handler = pending.get(msg.id);
      pending.delete(msg.id);
      handler(msg);
    }
  }
});

function request(id, method, params) {
  return new Promise((resolvePromise) => {
    pending.set(id, resolvePromise);
    send({ jsonrpc: '2.0', id, method, params });
  });
}

(async () => {
  const initResp = await request(1, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'qulib-smoke', version: '0.0.0' },
  });
  if (initResp.error) fail(`initialize returned an error: ${JSON.stringify(initResp.error)}`);

  // Notify initialized, then list tools.
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });

  const listResp = await request(2, 'tools/list', {});
  if (listResp.error) fail(`tools/list returned an error: ${JSON.stringify(listResp.error)}`);

  const tools = listResp.result?.tools ?? [];
  const names = tools.map((t) => t.name).sort();
  const missing = EXPECTED_TOOLS.filter((t) => !names.includes(t));

  if (missing.length > 0) {
    fail(`missing expected tools: ${missing.join(', ')} (got: ${names.join(', ') || '<none>'})`);
  }

  clearTimeout(timer);
  console.log(`[smoke] PASS: MCP server advertised ${tools.length} tools: ${names.join(', ')}`);
  child.kill('SIGTERM');
  process.exit(0);
})().catch((err) => fail(err?.message ?? String(err)));
