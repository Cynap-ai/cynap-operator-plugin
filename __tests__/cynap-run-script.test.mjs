// /cynap-run-script. Drives the REAL sandboxed host against an in-memory
// proxy + MCP endpoint: the token stays in the runner, the script's org is the working
// directory's, and the child can neither write, spawn nor (where gated) reach the network.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runScript, parseRunScriptArgs, resolveScript } from '../bin/cynap-run-script.mjs';
import { assertNetworkGated } from '../lib/sandboxed-node.mjs';

const ORG = 'acme';
// The sandbox can only deny network access on Node >= 25; CI runs these cases in its Node 25 step.
const nodeMajor = Number(process.versions.node.split('.')[0]);
const needsNode25 = { skip: nodeMajor < 25 && 'needs Node >= 25 (network denial); CI runs these in the Node 25 step' };
let home;
let cwd;
let dir;
let savedHome;

function jwt(claims) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${enc({ alg: 'ES256' })}.${enc(claims)}.sig`;
}
const WS_TOKEN = jwt({ scope: 'workspace:read', org_id: 'org_acme' });
const OPS_TOKEN = jwt({ scope: 'workspace:read-ops', org_id: 'org_acme' });

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A fake loopback proxy + upstream MCP. `overrides` swap individual replies. */
function fakeNetwork(overrides = {}) {
  const seen = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    seen.push({ url, headers: init.headers, body });
    if (url.endsWith('/script-token')) {
      const reply = overrides[`mint:${body.family}`];
      if (reply) return reply();
      return json(200, {
        ok: true,
        token: body.family === 'ops' ? OPS_TOKEN : WS_TOKEN,
        expires_in: 900,
        org_slug: ORG,
        org_id: 'org_acme',
        mcp_url: 'https://mcp.example/mcp/operator',
      });
    }
    if (body.method === 'tools/list') {
      const tools = init.headers.Authorization === `Bearer ${OPS_TOKEN}` ? ['runs_list'] : ['workspace_status'];
      return json(200, { jsonrpc: '2.0', id: 1, result: { tools: tools.map((name) => ({ name })) } });
    }
    const { name } = body.params;
    if (name === 'workspace_commit') {
      return json(200, { jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'tool not permitted for this scope' } });
    }
    return json(200, {
      jsonrpc: '2.0',
      id: 1,
      result: { content: [{ type: 'text', text: JSON.stringify({ tool: name, auth: init.headers.Authorization }) }] },
    });
  };
  return { fetchImpl, seen };
}

function writeScript(rel, source) {
  const abs = join(dir, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, source);
}

beforeEach(() => {
  savedHome = process.env.HOME;
  home = mkdtempSync(join(tmpdir(), 'cyn2217-run-script-'));
  process.env.HOME = home;
  cwd = join(home, 'CynapOperator', ORG);
  dir = join(cwd, `cynap-${ORG}`);
  mkdirSync(join(dir, '.cynap'), { recursive: true });
  writeFileSync(join(dir, '.cynap', 'state.json'), JSON.stringify({ org: ORG, base: null, files: {} }));
  writeFileSync(join(cwd, '.operator-control'), 'nonce-123\n');
});
afterEach(() => {
  process.env.HOME = savedHome;
  rmSync(home, { recursive: true, force: true });
});

test('runs the default export with { mcp, org, args } and returns its value', needsNode25, async () => {
  writeScript(
    'operator/scripts/status.mjs',
    `export default async function ({ mcp, org, args }) {
       const status = await mcp.call('workspace_status', {});
       const runs = await mcp.call('runs_list', {});
       return { org, args, status, runs };
     }`
  );
  const net = fakeNetwork();
  const result = await runScript({ cwd, argv: ['operator/scripts/status.mjs', 'a', 'b'], fetchImpl: net.fetchImpl });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.value.org, ORG);
  assert.deepEqual(result.value.args, ['a', 'b']);
  assert.deepEqual(result.value.status, { tool: 'workspace_status', auth: `Bearer ${WS_TOKEN}` });
  assert.deepEqual(result.value.runs, { tool: 'runs_list', auth: `Bearer ${OPS_TOKEN}` });
  const mints = net.seen.filter((c) => c.url.endsWith('/script-token'));
  assert.deepEqual(mints.map((c) => c.body.family), ['workspace', 'ops']);
  assert.equal(mints[0].headers['x-cynap-operator-control'], 'nonce-123');
});

test('the script sees no token, and cannot write, spawn or reach the network', needsNode25, async () => {
  writeScript(
    'operator/scripts/probe.mjs',
    `import { writeFileSync } from 'node:fs';
     import { execSync } from 'node:child_process';
     import { connect } from 'node:net';
     export default async function () {
       const out = { env: { ...process.env }, argv: process.argv.join(' ') };
       try { writeFileSync('owned.txt', 'x'); out.write = 'allowed'; } catch (e) { out.write = e.code; }
       try { execSync('true'); out.child = 'allowed'; } catch (e) { out.child = e.code; }
       try {
         await new Promise((res, rej) => { const s = connect(9, '127.0.0.1'); s.on('error', rej); s.on('connect', res); });
         out.net = 'allowed';
       } catch (e) { out.net = e.code; }
       return out;
     }`
  );
  const result = await runScript({ cwd, argv: ['operator/scripts/probe.mjs'], fetchImpl: fakeNetwork().fetchImpl });
  assert.equal(result.ok, true, result.error);
  const serialized = JSON.stringify(result.value);
  assert.ok(!serialized.includes(WS_TOKEN) && !serialized.includes(OPS_TOKEN), 'a token leaked into the script');
  // macOS injects __CF_USER_TEXT_ENCODING into every process; nothing else may arrive.
  assert.deepEqual(Object.keys(result.value.env).filter((key) => !key.startsWith('__CF_')), []);
  assert.equal(result.value.write, 'ERR_ACCESS_DENIED');
  assert.equal(result.value.child, 'ERR_ACCESS_DENIED');
  assert.equal(result.value.net, 'ERR_ACCESS_DENIED');
  assert.equal(existsSync(join(dir, 'owned.txt')), false);
});

test("a write tool is refused by the server's reply and surfaces to the script as an error", needsNode25, async () => {
  writeScript(
    'operator/scripts/write.mjs',
    `export default async function ({ mcp }) {
       try { await mcp.call('workspace_commit', { changes: [] }); return 'committed'; }
       catch (e) { return e.message; }
     }`
  );
  const result = await runScript({ cwd, argv: ['operator/scripts/write.mjs'], fetchImpl: fakeNetwork().fetchImpl });
  assert.equal(result.ok, true, result.error);
  assert.match(result.value, /tools\/call refused: .*not permitted/);
});

test('refuses before the script starts when the proxy serves a different org', needsNode25, async () => {
  writeScript('operator/scripts/x.mjs', 'export default async () => 1;');
  const net = fakeNetwork({
    'mint:workspace': () => json(200, { ok: true, token: WS_TOKEN, org_slug: 'other', org_id: 'org_acme', mcp_url: 'x' }),
  });
  let forked = false;
  await assert.rejects(
    runScript({ cwd, argv: ['operator/scripts/x.mjs'], fetchImpl: net.fetchImpl, forkImpl: () => (forked = true) }),
    /org mismatch/
  );
  assert.equal(forked, false);
});

test('refuses a minted token whose scope is wider than read', needsNode25, async () => {
  writeScript('operator/scripts/x.mjs', 'export default async () => 1;');
  const wide = jwt({ scope: 'workspace:execute-preview', org_id: 'org_acme' });
  const net = fakeNetwork({
    'mint:workspace': () => json(200, { ok: true, token: wide, org_slug: ORG, org_id: 'org_acme', mcp_url: 'x' }),
  });
  await assert.rejects(runScript({ cwd, argv: ['operator/scripts/x.mjs'], fetchImpl: net.fetchImpl }), /only "workspace:read"/);
});

test('runs with the workspace token alone when the seat has no ops grant', needsNode25, async () => {
  writeScript('operator/scripts/x.mjs', `export default async ({ mcp }) => mcp.call('workspace_status');`);
  const net = fakeNetwork({ 'mint:ops': () => json(403, { error: 'no_grant' }) });
  const result = await runScript({ cwd, argv: ['operator/scripts/x.mjs'], fetchImpl: net.fetchImpl });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.value.tool, 'workspace_status');
});

test('refuses a working directory pulled for another org', needsNode25, async () => {
  writeFileSync(join(dir, '.cynap', 'state.json'), JSON.stringify({ org: 'other', base: null, files: {} }));
  writeScript('operator/scripts/x.mjs', 'export default async () => 1;');
  await assert.rejects(runScript({ cwd, argv: ['operator/scripts/x.mjs'], fetchImpl: fakeNetwork().fetchImpl }), /different org/);
});

test('refuses a script outside operator/scripts/', () => {
  writeScript('automations/x.mjs', 'export default async () => 1;');
  assert.throws(() => resolveScript(dir, 'automations/x.mjs'), /not under operator\/scripts\//);
  assert.throws(() => resolveScript(dir, '../outside.mjs'), /not under operator\/scripts\//);
});

test('a script that throws fails the run with its error', needsNode25, async () => {
  writeScript('operator/scripts/boom.mjs', `export default async () => { throw new Error('boom'); };`);
  const result = await runScript({ cwd, argv: ['operator/scripts/boom.mjs'], fetchImpl: fakeNetwork().fetchImpl });
  assert.equal(result.ok, false);
  assert.match(result.error, /boom/);
});

test('parses options before the script path and passes the rest through', () => {
  assert.deepEqual(parseRunScriptArgs(['--dir', 'd', 'operator/scripts/x.mjs', '--flag', 'v']), {
    dir: 'd',
    scriptPath: 'operator/scripts/x.mjs',
    scriptArgs: ['--flag', 'v'],
  });
  assert.throws(() => parseRunScriptArgs([]), /Usage/);
});

test('refuses a runtime whose sandbox cannot deny the network, naming the version', () => {
  assert.throws(() => assertNetworkGated('24.9.0', new Set(['--allow-fs-read'])), /Node 24\.9\.0 cannot deny network access .*Node >= 25/);
  assert.doesNotThrow(() => assertNetworkGated('25.1.0', new Set(['--allow-net'])));
});

test('on Node < 25 runScript refuses before starting the script, naming the version found', { skip: nodeMajor >= 25 && 'only meaningful where the sandbox cannot deny the network' }, async () => {
  writeScript('operator/scripts/x.mjs', 'export default async () => 1;');
  await assert.rejects(
    runScript({ cwd, argv: ['operator/scripts/x.mjs'], fetchImpl: fakeNetwork().fetchImpl }),
    new RegExp(`Node ${process.versions.node.replaceAll('.', '\\.')} cannot deny network access to a sandboxed script — operator scripts need Node >= 25`)
  );
});
