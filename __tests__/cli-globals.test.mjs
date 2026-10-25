import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';

import { applyGlobalFlags, helpText, ORG_ENV, splitGlobalFlags } from '../lib/cli-globals.mjs';
import { resolveOrgSlug, resolveWorkspaceDir } from '../lib/workspace-sync.mjs';
import { formatToolList, listTools, parseToolsArgs } from '../bin/cynap-tools.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('splitGlobalFlags strips --org in both spellings and finds --help', () => {
  assert.deepEqual(splitGlobalFlags(['--org', 'cynap-e2e', 'abc']), { argv: ['abc'], org: 'cynap-e2e', help: false });
  assert.deepEqual(splitGlobalFlags(['--org=cynap-e2e']), { argv: [], org: 'cynap-e2e', help: false });
  assert.equal(splitGlobalFlags(['push', '--help']).help, true);
  assert.equal(splitGlobalFlags(['-h']).help, true);
  assert.equal(splitGlobalFlags(['script', '-h']).help, false, '-h is only help when it is the sole argument');
  assert.deepEqual(splitGlobalFlags(['x', '--', '--help', '--org', 'y']).argv, ['x', '--', '--help', '--org', 'y']);
  assert.throws(() => splitGlobalFlags(['--org']), /--org needs a connected org slug/);
  assert.throws(() => splitGlobalFlags(['--org', '../etc']), /--org needs/);
});

test('applyGlobalFlags exports --org, rewrites argv, and prints help then exits 0', () => {
  const env = {};
  const argv = ['node', 'bin.mjs', '--org', 'cynap-e2e', 'a', 'b'];
  applyGlobalFlags(pathToFileURL(join(ROOT, 'bin', 'cynap-status.mjs')).href, { argv, env, exit: () => assert.fail('no exit') });
  assert.equal(env[ORG_ENV], 'cynap-e2e');
  assert.deepEqual(argv, ['node', 'bin.mjs', 'a', 'b']);

  let printed = '';
  let code = null;
  applyGlobalFlags(pathToFileURL(join(ROOT, 'bin', 'cynap-status.mjs')).href, {
    argv: ['node', 'x', '--help'], env: {}, out: { write: (text) => { printed += text; } }, exit: (c) => { code = c; },
  });
  assert.equal(code, 0);
  assert.match(printed, /cynap-status \[--dir <workspace>\] \[--json\]/);
  assert.match(printed, /Shared flags: --help, --org/);
});

test('--org decides the org from any folder, and a workspace falls back to ~/CynapOperator/<org>', () => {
  assert.equal(resolveOrgSlug({ cwd: '/tmp/anywhere', env: { [ORG_ENV]: 'cynap-e2e' } }), 'cynap-e2e');
  assert.equal(resolveOrgSlug({ cwd: '/tmp/anywhere', env: {} }), 'anywhere');
  const before = process.env[ORG_ENV];
  process.env[ORG_ENV] = 'cynap-e2e';
  try {
    assert.ok(resolveWorkspaceDir({ cwd: "/tmp/anywhere" }).startsWith(join(homedir(), "CynapOperator", "cynap-e2e")));
  } finally {
    if (before === undefined) delete process.env[ORG_ENV]; else process.env[ORG_ENV] = before;
  }
});

test('every command bin answers --help with its command doc and exits 0', () => {
  const bins = readdirSync(join(ROOT, 'bin')).filter((f) => /^cynap-[a-z-]+\.mjs$/.test(f))
    .filter((f) => !/-core\.mjs$|script-host\.mjs$/.test(f));
  assert.ok(bins.length >= 14, `expected the command bins, saw ${bins.length}`);
  for (const bin of bins) {
    const out = execFileSync(process.execPath, [join(ROOT, 'bin', bin), '--help'], { encoding: 'utf8', timeout: 20_000 });
    assert.match(out, /Shared flags: --help, --org/, `${bin} --help`);
    assert.match(out, new RegExp(`^cynap-${bin.replace(/^cynap-|(-runner)?\.mjs$/g, '')}`), `${bin} names itself`);
  }
});

test('every command bin has a command doc and every command doc a bin', () => {
  for (const doc of readdirSync(join(ROOT, 'commands'))) {
    const name = doc.replace(/\.md$/, '');
    assert.ok(existsSync(join(ROOT, 'bin', `${name}.mjs`)) || existsSync(join(ROOT, 'bin', `${name}-runner.mjs`)), `${doc} has a bin`);
  }
  assert.match(helpText(pathToFileURL(join(ROOT, 'bin', 'cynap-checks-runner.mjs')).href), /^cynap-checks-runner/);
});

test('cynap-tools lists signatures, follows nextCursor, and prints one schema', async () => {
  const pages = [
    { result: { tools: [{ name: 'automation_run_trigger', description: 'Start a real run. More text.', inputSchema: { properties: { automation_id: {}, input: {} }, required: ['automation_id'] } }], nextCursor: 'c2' } },
    { result: { tools: [{ name: 'workspace_status', description: 'Read the chain.', inputSchema: { properties: {} } }] } },
  ];
  const cursors = [];
  const fetchImpl = async (_url, init) => { cursors.push(JSON.parse(init.body).params.cursor); return { ok: true, json: async () => pages.shift() }; };
  const tools = await listTools({ proxyUrl: 'http://127.0.0.1:1/mcp', fetchImpl });
  assert.deepEqual(cursors, [undefined, 'c2']);
  assert.equal(formatToolList(tools), 'automation_run_trigger(automation_id, input?)  Start a real run.\nworkspace_status()  Read the chain.\n');
  assert.deepEqual(parseToolsArgs(['automation_run_trigger', '--json']), { name: 'automation_run_trigger', json: true });
  assert.throws(() => parseToolsArgs(['Bad Name']), /Usage/);
});
