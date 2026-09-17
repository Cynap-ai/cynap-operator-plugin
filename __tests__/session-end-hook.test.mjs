// CYN-801 — hooks/hooks.json shape + hooks/session-end.sh fail-open contract.
// Zero network for the fail-open cases (no proxy listening); the "fires only
// for operator-MCP-touched sessions" gate lives in the PROXY's /session-end
// handler (see the local proxy source/__tests__/session-trail-proxy.test.mjs) — this
// suite only proves the HOOK itself never blocks/fails termination and only
// signals when a `.mcp.json` naming `cynap-operator` actually exists in cwd.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, mkdtempSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(__dirname, '..');
const HOOK_PATH = join(PLUGIN_ROOT, 'hooks', 'session-end.sh');
const HOOKS_JSON_PATH = join(PLUGIN_ROOT, 'hooks', 'hooks.json');

function runHook(stdinJson, env = {}) {
  return execFileSync('bash', [HOOK_PATH], {
    input: JSON.stringify(stdinJson),
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

const execFileAsync = promisify(execFile);

/** ASYNC variant — REQUIRED whenever the hook signals back into an HTTP
 * server running in THIS SAME test process (execFileSync blocks the whole
 * Node event loop, so the in-process server could never accept the hook's
 * own curl connection — a same-process deadlock, not a hook bug). */
function runHookAsync(stdinJson, env = {}) {
  const child = execFileAsync('bash', [HOOK_PATH], {
    env: { ...process.env, ...env },
  });
  child.child.stdin.end(JSON.stringify(stdinJson));
  return child;
}

test('hooks.json declares a SessionEnd hook pointing at ${CLAUDE_PLUGIN_ROOT}/hooks/session-end.sh, async:true', () => {
  const hooks = JSON.parse(readFileSync(HOOKS_JSON_PATH, 'utf8'));
  const sessionEnd = hooks.hooks.SessionEnd;
  assert.ok(Array.isArray(sessionEnd) && sessionEnd.length > 0);
  const entry = sessionEnd[0].hooks[0];
  assert.equal(entry.type, 'command');
  assert.equal(entry.command, '${CLAUDE_PLUGIN_ROOT}/hooks/session-end.sh');
  assert.equal(entry.async, true);
});

test('the hook script is executable', () => {
  const mode = statSync(HOOK_PATH).mode;
  assert.ok(mode & 0o100, 'hooks/session-end.sh must have the executable bit set');
});

test('fail-open: exits 0 with no CWD or session id in stdin', () => {
  assert.doesNotThrow(() => runHook({}));
});

test('fail-open: exits 0 when CWD has no .mcp.json (never connected to the operator plane)', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'cynap-hook-test-'));
  try {
    assert.doesNotThrow(() =>
      runHook({ cwd: scratch, session_id: 'sess-1' }, { CLAUDE_SESSION_ID: 'sess-1' })
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('fail-open: exits 0 even with a malformed .mcp.json (never crashes on bad JSON)', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'cynap-hook-test-'));
  try {
    writeFileSync(join(scratch, '.mcp.json'), 'not json {{{');
    assert.doesNotThrow(() =>
      runHook({ cwd: scratch, session_id: 'sess-1' }, { CLAUDE_SESSION_ID: 'sess-1' })
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('fail-open: a session id with a path-traversal shape is rejected (exit 0, no signal sent)', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'cynap-hook-test-'));
  try {
    writeFileSync(
      join(scratch, '.mcp.json'),
      JSON.stringify({ mcpServers: { 'cynap-operator': { type: 'http', url: 'http://127.0.0.1:9999/mcp' } } })
    );
    assert.doesNotThrow(() =>
      runHook({ cwd: scratch, session_id: '../etc/passwd' }, { CLAUDE_SESSION_ID: '../etc/passwd' })
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('signals the local proxy /session-end endpoint derived from .mcp.json when connected', async () => {
  const scratch = mkdtempSync(join(tmpdir(), 'cynap-hook-test-'));
  let received = null;
  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/session-end') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'uploaded' }));
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    writeFileSync(
      join(scratch, '.mcp.json'),
      JSON.stringify({
        mcpServers: { 'cynap-operator': { type: 'http', url: `http://127.0.0.1:${port}/mcp` } },
      })
    );
    // ASYNC on purpose: the hook's curl connects BACK to this test's own
    // in-process http server — a synchronous execFileSync would freeze the
    // event loop that the server needs to accept that very connection.
    await runHookAsync({ cwd: scratch, session_id: 'sess-real' }, { CLAUDE_SESSION_ID: 'sess-real' });
    assert.ok(received, 'the proxy /session-end endpoint should have been signalled');
    assert.equal(received.session_id, 'sess-real');
  } finally {
    server.close();
    rmSync(scratch, { recursive: true, force: true });
  }
});
