// The Build Facts PostToolUse hook (hooks/posttooluse-build-facts.mjs and
// lib/build-facts-hook.mjs). The server decides claim plus Stated intent; these tests pin the
// client contract: no network outside a connected workspace, only `served` answers inject, at most
// three facts, never the same fact twice in one session, the policy version in the output, and a
// client deadline between the server's post_write deadline and the hooks.json timeout.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  formatBuildFacts,
  handlerIdOf,
  HOOK_CLIENT_DEADLINE_MS,
  INJECTED_REL_PATH,
  isPushCommand,
  planHook,
  readHandlerContext,
  runBuildFactsHook,
} from '../lib/build-facts-hook.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(__dirname, '..');
const REPO_ROOT = join(PLUGIN_ROOT, '..', '..');
const HOOK_PATH = join(PLUGIN_ROOT, 'hooks', 'posttooluse-build-facts.mjs');
const HOOKS_JSON = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'hooks', 'hooks.json'), 'utf8'));
const POLICY = JSON.parse(readFileSync(join(REPO_ROOT, 'apps', 'customers', 'scripts', 'platform-config-policy.json'), 'utf8'));

const SEED = { id: 'fact:advanced-query-page-by-row-width', rule: 'A read is capped by bytes and rows.', remedy: 'Page with a smaller limit.' };
const POLICY_VERSION = 'a'.repeat(64);

const scratchDirs = [];
function scratch(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
}
test.after(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

function write(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** `<home>/CynapOperator/<slug>` with `.mcp.json`, a synced workspace and one handler. */
function makeWorkspace({ port = 41234, connected = true, tools = ['knowledge.advancedQuery'] } = {}) {
  const home = scratch('cynap-bf-hook-');
  const operatorRoot = join(home, 'CynapOperator');
  const root = join(operatorRoot, 'acme');
  mkdirSync(root, { recursive: true });
  if (connected) write(join(root, '.mcp.json'), JSON.stringify({ mcpServers: { 'cynap-operator': { type: 'http', url: `http://127.0.0.1:${port}/mcp` } } }));
  write(join(root, '.cynap', 'state.json'), JSON.stringify({ org: 'acme', base: null, files: {} }));
  write(join(root, 'automations', 'handlers', 'invoice-sync', 'config.json'), JSON.stringify({ execution: { mode: 'code_execution', allowed_tools: tools } }));
  write(join(root, 'automations', 'handlers', 'invoice-sync', 'handler.ts'), 'export default async () => {};\n');
  write(join(root, 'automations', 'nightly.json'), JSON.stringify({ execution: { mode: 'deterministic' } }));
  return { home, operatorRoot, root };
}

function writeEvent(root, file = join(root, 'automations', 'handlers', 'invoice-sync', 'handler.ts'), sessionId = 'session-1') {
  return { session_id: sessionId, cwd: root, hook_event_name: 'PostToolUse', tool_name: 'Write', tool_input: { file_path: file } };
}

/** A fetch double that answers `tools/call` with `answer` and records every call. */
function fakeFetch(answer) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    if (answer instanceof Error) throw answer;
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: JSON.stringify(answer) }] } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  return { impl, calls };
}

const served = (facts = [SEED]) => ({ outcome: 'served', policy_version: POLICY_VERSION, facts });

test('hooks.json runs the hook synchronously after handler writes and Bash, and the script is executable', () => {
  const entries = HOOKS_JSON.hooks.PostToolUse;
  assert.deepEqual(entries.map((entry) => entry.matcher), ['Write|Edit|MultiEdit', 'Bash']);
  for (const entry of entries) {
    assert.equal(entry.hooks.length, 1);
    assert.equal(entry.hooks[0].command, '${CLAUDE_PLUGIN_ROOT}/hooks/posttooluse-build-facts.mjs');
    assert.equal(entry.hooks[0].async, false);
  }
  assert.ok(statSync(HOOK_PATH).mode & 0o100, 'hooks/posttooluse-build-facts.mjs must be executable');
});

test('the client deadline sits below every hook timeout and above the server post_write deadline', () => {
  for (const entry of HOOKS_JSON.hooks.PostToolUse) assert.ok(HOOK_CLIENT_DEADLINE_MS < entry.hooks[0].timeout * 1000);
  assert.ok(HOOK_CLIENT_DEADLINE_MS > POLICY.build_facts.post_write_deadline_ms);
  assert.equal(POLICY.build_facts.channels.post_write.top_k, 3);
});

test('handlerIdOf names nested and flat handler files only', () => {
  assert.equal(handlerIdOf('automations/handlers/invoice-sync/handler.ts'), 'invoice-sync');
  assert.equal(handlerIdOf('automations/handlers/invoice-sync/config.json'), 'invoice-sync');
  assert.equal(handlerIdOf('automations/nightly.ts'), 'nightly');
  assert.equal(handlerIdOf('automations/nightly.manifest.json'), null);
  assert.equal(handlerIdOf('automations/handlers/invoice-sync/preview-input.json'), null);
  assert.equal(handlerIdOf('context/schema.json'), null);
});

test('isPushCommand matches the cynap-push command and nothing that merely contains the word', () => {
  assert.ok(isPushCommand('node "/p/bin/cynap-push.mjs" -m "fix paging"'));
  assert.ok(isPushCommand('cynap-push --dry-run'));
  assert.ok(!isPushCommand('node /p/bin/cynap-pull.mjs'));
  assert.ok(!isPushCommand('cat notes/cynap-push-notes.md'));
  assert.ok(!isPushCommand(undefined));
});

test('planHook: a handler write in a connected workspace carries the handler mode and declared tools', () => {
  const { operatorRoot, root } = makeWorkspace();
  const plan = planHook(writeEvent(root), { operatorRoot });
  assert.equal(plan.proxyUrl, 'http://127.0.0.1:41234/mcp');
  assert.deepEqual(plan.contexts, [{ mode: 'code_execution', tools: ['knowledge.advancedQuery'] }]);
});

test('planHook: no plan outside an operator workspace, without .mcp.json, or for a non-handler file', () => {
  const { operatorRoot, root } = makeWorkspace();
  assert.equal(planHook({ ...writeEvent(root), cwd: '/tmp' }, { operatorRoot }), null);
  assert.equal(planHook(writeEvent(root, join(root, 'context', 'schema.json')), { operatorRoot }), null);
  assert.equal(planHook({ ...writeEvent(root), tool_name: 'Read' }, { operatorRoot }), null);
  const offline = makeWorkspace({ connected: false });
  assert.equal(planHook(writeEvent(offline.root), { operatorRoot: offline.operatorRoot }), null);
});

test('readHandlerContext reads execution.mode; a top-level mode is not a mode', () => {
  const root = scratch('bf-hook-mode-');
  write(join(root, 'automations', 'handlers', 'h', 'config.json'), JSON.stringify({ mode: 'code_execution', execution: { allowed_tools: ['knowledge.advancedQuery'] } }));
  assert.deepEqual(readHandlerContext(root, 'h'), { tools: ['knowledge.advancedQuery'] });
  write(join(root, 'automations', 'handlers', 'h', 'config.json'), JSON.stringify({ execution: { mode: 'code_execution', allowed_tools: ['knowledge.advancedQuery'] } }));
  assert.deepEqual(readHandlerContext(root, 'h'), { mode: 'code_execution', tools: ['knowledge.advancedQuery'] });
});

test('planHook: a cynap-push reads every handler config, one context per mode', () => {
  const { operatorRoot, root } = makeWorkspace();
  const plan = planHook({ session_id: 's', cwd: root, tool_name: 'Bash', tool_input: { command: 'node /p/bin/cynap-push.mjs -m x' } }, { operatorRoot });
  assert.deepEqual(plan.contexts, [{ mode: 'code_execution', tools: ['knowledge.advancedQuery'] }, { mode: 'deterministic' }]);
  assert.equal(planHook({ session_id: 's', cwd: root, tool_name: 'Bash', tool_input: { command: 'ls' } }, { operatorRoot }), null);
});

test('runBuildFactsHook makes no network call outside a connected workspace', async () => {
  const { operatorRoot, root } = makeWorkspace({ connected: false });
  const fetch = fakeFetch(served());
  assert.equal(await runBuildFactsHook(writeEvent(root), { fetchImpl: fetch.impl, operatorRoot }), null);
  assert.equal(await runBuildFactsHook({ ...writeEvent(root), cwd: '/tmp' }, { fetchImpl: fetch.impl, operatorRoot }), null);
  assert.equal(fetch.calls.length, 0);
});

test('a served answer injects the facts with the policy version; the call is post_write build_facts_query', async () => {
  const { operatorRoot, root } = makeWorkspace();
  const fetch = fakeFetch(served());
  const text = await runBuildFactsHook(writeEvent(root), { fetchImpl: fetch.impl, operatorRoot });
  assert.match(text, /policy aaaaaaaaaaaa/);
  assert.match(text, /fact:advanced-query-page-by-row-width: A read is capped by bytes and rows\. Remedy: Page with a smaller limit\./);
  assert.equal(fetch.calls.length, 1);
  assert.equal(fetch.calls[0].url, 'http://127.0.0.1:41234/mcp');
  assert.deepEqual(fetch.calls[0].body.params, {
    name: 'build_facts_query',
    arguments: { mode: 'code_execution', tools: ['knowledge.advancedQuery'], channel: 'post_write' },
  });
});

test('the same fact is never injected twice in one session, and is again in a new session', async () => {
  const { operatorRoot, root } = makeWorkspace();
  const fetch = fakeFetch(served());
  assert.ok(await runBuildFactsHook(writeEvent(root), { fetchImpl: fetch.impl, operatorRoot }));
  assert.equal(await runBuildFactsHook(writeEvent(root), { fetchImpl: fetch.impl, operatorRoot }), null);
  assert.ok(await runBuildFactsHook(writeEvent(root, undefined, 'session-2'), { fetchImpl: fetch.impl, operatorRoot }));
  const record = JSON.parse(readFileSync(join(root, INJECTED_REL_PATH), 'utf8'));
  assert.ok(!JSON.stringify(record).includes('session-1'), 'the dedupe record never stores a raw session id');
});

test('at most three facts are injected', async () => {
  const { operatorRoot, root } = makeWorkspace();
  const facts = [1, 2, 3, 4].map((n) => ({ id: `fact:f-${n}`, rule: `Rule ${n}.`, remedy: null }));
  const text = await runBuildFactsHook(writeEvent(root), { fetchImpl: fakeFetch(served(facts)).impl, operatorRoot });
  assert.equal(text.split('\n').filter((line) => line.startsWith('- fact:')).length, 3);
});

test('every answer that is not served injects nothing', async () => {
  for (const outcome of ['empty', 'gated', 'unbound', 'gate_unavailable', 'timeout', 'rate_limited', 'artifact_unavailable', 'invalid_args']) {
    const { operatorRoot, root } = makeWorkspace();
    const answer = { outcome, policy_version: POLICY_VERSION, facts: [] };
    assert.equal(await runBuildFactsHook(writeEvent(root), { fetchImpl: fakeFetch(answer).impl, operatorRoot }), null, outcome);
  }
});

test('a dead proxy or a slow server injects nothing, within the client deadline', async () => {
  const { operatorRoot, root } = makeWorkspace();
  assert.equal(await runBuildFactsHook(writeEvent(root), { fetchImpl: fakeFetch(new Error('ECONNREFUSED')).impl, operatorRoot }), null);
  const hang = (url, init) =>
    new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
  const started = Date.now();
  assert.equal(await runBuildFactsHook(writeEvent(root), { fetchImpl: hang, operatorRoot, deadlineMs: 50 }), null);
  assert.ok(Date.now() - started < 2000);
});

test('formatBuildFacts names an enforced_by pointer', () => {
  const text = formatBuildFacts([{ id: 'fact:x', rule: 'R.', remedy: null, enforced_by: 'SOME_CODE' }], POLICY_VERSION);
  assert.match(text, /- fact:x: R\. Enforced by SOME_CODE\./);
});

function runAdapter(stdin, home) {
  return new Promise((resolve) => {
    const child = execFile(process.execPath, [HOOK_PATH], { env: { ...process.env, HOME: home }, timeout: 15000 }, (error, stdout) =>
      resolve({ code: error ? (error.code ?? 1) : 0, stdout })
    );
    child.stdin.end(stdin);
  });
}

test('the adapter prints PostToolUse additionalContext from a real loopback proxy, and nothing on junk', async () => {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const { id } = JSON.parse(body);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(served()) }] } }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { home, root } = makeWorkspace({ port: server.address().port });
    const ok = await runAdapter(JSON.stringify(writeEvent(root)), home);
    assert.equal(ok.code, 0);
    const out = JSON.parse(ok.stdout);
    assert.equal(out.hookSpecificOutput.hookEventName, 'PostToolUse');
    assert.match(out.hookSpecificOutput.additionalContext, /fact:advanced-query-page-by-row-width/);

    const junk = await runAdapter('not json', home);
    assert.deepEqual(junk, { code: 0, stdout: '' });
  } finally {
    server.close();
  }
});
