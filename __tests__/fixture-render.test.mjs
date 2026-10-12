import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import { join } from 'node:path';
import { render, parseRenderArgs, scaffoldFixture } from '../bin/cynap-render.mjs';
import { push } from '../bin/cynap-push.mjs';
import { createFixturePaint, FIXTURE_RENDER_STATES } from '../lib/fixture-paint.mjs';
import { FixtureSchema, FixtureRenderStateSchema } from '../lib/fixture-schema.generated.mjs';
import { createFixtureBroker, partialMatch } from '../lib/fixture-broker.mjs';
import { fixtureDocument, inertJson } from '../lib/fixture-document.mjs';
import { parseFixtureJson } from '../lib/fixture-json.mjs';
import { serveFixtures } from '../lib/fixture-server.mjs';
import { writeStateAtomic, sha256Hex, listLocalFiles } from '../lib/workspace-sync.mjs';
const cwd = '/tmp/operator/cynap-e2e';
const source = { 'index.tsx': 'export {}', 'routes.json': '{"version":1,"routes":[{"path":"queue","view":"records"}]}', 'tools.json': '{"version":1,"tools":[{"tool":"knowledge_query_data:knowledge_advanced_query"}]}' };
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), 'fixture-test-'));
  mkdirSync(join(dir, 'surfaces/work-queue'), { recursive: true });
  for (const [p, text] of Object.entries(source)) writeFileSync(join(dir, 'surfaces/work-queue', p), text);
  writeStateAtomic(dir, { org: 'cynap-e2e', base: 'a'.repeat(64), files: {} });
  return dir;
};
const fetcher = (calls, response = null) => async (_url, init) => {
  if (init.method === 'GET') return { ok: false };
  const { name, arguments: args } = JSON.parse(init.body).params; calls.push({ name, args });
  let data;
  if (name === 'workspace_tree') data = { ok: true, entries: [], commit_sha: 'live' };
  else if (name === 'workspace_commit') data = { ok: true, commit: { commit_sha: 'b'.repeat(64) } };
  else if (name === 'workspace_get_commit') data = { ok: true, state: 'pending' };
  else if (name === 'workspace_validate') data = { ok: true };
  else if (name === 'workspace_surface_render_build') data = response ?? { ok: true, bundle_html: '<!doctype html><p>Sample</p>', bundle_sha256: sha256Hex(Buffer.from('<!doctype html><p>Sample</p>')), bridge_protocol: '2026-01-26', findings: [], request_id: 'synthetic-request' };
  else throw new Error(`Unexpected tool: ${name}`);
  return { ok: true, json: async () => ({ result: { structuredContent: data } }) };
};
test('fresh workspace scaffolds four renders; only one Surface source is sent; no commit', async () => {
  const dir = scratch(); const calls = []; let output;
  try {
    output = await render({ cwd, argv: ['work-queue', '--dir', dir], fetchImpl: fetcher(calls) });
    assert.equal(output.ok, true); assert.equal(output.pages.length, 4);
    const fixture = FixtureSchema.parse(JSON.parse(readFileSync(join(dir, 'surfaces/work-queue/__fixtures__/render.json'))));
    assert.equal(fixture.states.populated.length, 1);
    assert.deepEqual(calls.at(-1).args, { surfaceId: 'work-queue', files: Object.keys(source).sort().map((path) => ({ path, content: source[path] })) });
    assert(!JSON.stringify(calls).includes('__fixtures__')); assert(!calls.some(c => c.name === 'workspace_commit'));
    assert.equal(JSON.parse(readFileSync(join(dir, '.cynap/state.json'))).base, 'a'.repeat(64));
    for (const page of output.pages) assert(readFileSync(join(output.scratch, page.file), 'utf8').includes('Fixture render, nothing was written'));
  } finally { rmSync(dir, { recursive: true, force: true }); if (output?.scratch) rmSync(output.scratch, { recursive: true, force: true }); }
});
test('a binary asset is sent as base64 and text files keep their plain shape', async () => {
  const dir = scratch(); const calls = []; let output;
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
  writeFileSync(join(dir, 'surfaces/work-queue/logo.png'), png);
  try {
    output = await render({ cwd, argv: ['work-queue', '--dir', dir], fetchImpl: fetcher(calls) });
    assert.equal(output.ok, true);
    const sent = calls.findLast(c => c.name === 'workspace_surface_render_build').args.files;
    assert.deepEqual(sent.find(f => f.path === 'logo.png'), { path: 'logo.png', encoding: 'base64', content: png.toString('base64') });
    assert(sent.filter(f => f.path !== 'logo.png').every(f => !('encoding' in f)));
  } finally { rmSync(dir, { recursive: true, force: true }); if (output?.scratch) rmSync(output.scratch, { recursive: true, force: true }); }
});
test('push skips fixture subtree before classification, including fixture symlinks', async () => {
  const dir = scratch(); const calls = [];
  try {
    mkdirSync(join(dir, 'surfaces/work-queue/__fixtures__')); symlinkSync('/nonexistent', join(dir, 'surfaces/work-queue/__fixtures__/render.json'));
    assert(!listLocalFiles(dir).some(p => p.includes('__fixtures__')));
    const result = await push({ cwd, argv: ['--dir', dir, '-m', 'Synthetic test'], fetchImpl: fetcher(calls) });
    assert.equal(result.ok, true);
    assert(calls.find(c => c.name === 'workspace_validate').args.changes.operations.length === 3);
    assert(!JSON.stringify(calls).includes('__fixtures__'));
    assert(calls.some(c => c.name === 'workspace_commit'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('render rejects a symlinked fixture rather than reading it', async () => {
  const dir = scratch();
  try { symlinkSync('/tmp', join(dir, 'surfaces/work-queue/__fixtures__')); await assert.rejects(render({ cwd, argv: ['work-queue', '--dir', dir], fetchImpl: fetcher([]) }), /real directory/); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});
test('strict fixtures reject extra keys and missing states; JSON rejects duplicate keys and accepts BOM', () => {
  const fixture = scaffoldFixture('work-queue', []);
  assert(FixtureSchema.safeParse(fixture).success);
  assert(!FixtureSchema.safeParse({ ...fixture, extra: 1 }).success);
  assert(!FixtureSchema.safeParse({ ...fixture, context: { ...fixture.context, extra: 1 } }).success);
  assert(FixtureSchema.safeParse({ ...fixture, context: { ...fixture.context, query: { id: 'fixture-record' } } }).success);
  assert(!FixtureSchema.safeParse({ ...fixture, context: { ...fixture.context, query: { id: 42 } } }).success);
  assert(!FixtureSchema.safeParse({ ...fixture, states: {} }).success);
  assert(!FixtureSchema.safeParse({ ...fixture, states: { ...fixture.states, empty: [{ tool: 'x', response: { data: {}, extra: 1 } }] } }).success);
  assert.throws(() => parseFixtureJson('{"x":1,"x":2}'), /Duplicate/);
  assert.deepEqual(parseFixtureJson('\uFEFF{"nested":[{"x":1}]}'), { nested: [{ x: 1 }] });
});
test('broker matches dispatcher routes and ordered partial args; missing reads fail loudly', async () => {
  const missing = []; const calls = [];
  const broker = createFixtureBroker({ entries: [{ tool: 'knowledge_query_data:detail', match: { params: { id: 'one' } }, response: { data: { name: 'One' } } }], viewer: { role: 'owner', displayName: 'Sample' }, isWrite: () => false, admission: () => null, onMissing: tool => missing.push(tool), onCall: call => calls.push(call) });
  assert(partialMatch({ a: { b: 1 } }, { a: { b: 1, c: 2 } }));
  assert.equal((await broker({ tool: 'knowledge_query_data', arguments: { tool: 'detail', params: { id: 'one', extra: 1 } } })).structuredContent.name, 'One');
  assert.equal((await broker({ tool: 'missing', arguments: {} })).isError, true); assert.deepEqual(missing, ['missing']);
  assert.deepEqual((await broker({ tool: 'viewer_context', arguments: {} })).structuredContent, { viewerRole: 'owner', viewerDisplayName: 'Sample', orgDisplayName: 'Synthetic fixture org' });
});
test('simulated write outcome belongs to its status id; pending, denied and errors stay distinct', async () => {
  const broker = createFixtureBroker({ entries: [{ tool: 'write', response: { write: 'failed' } }, { tool: 'wait', response: { pending: true } }, { tool: 'deny', response: { denied: true } }, { tool: 'err', response: { error: { code: 'oops', message: 'Failed' } } }], isWrite: t => t === 'write', admission: () => 'automation', viewer: {} });
  const write = await broker({ tool: 'write', arguments: {} });
  assert.equal((await broker({ tool: 'automation_run_status', arguments: { trigger_id: write.structuredContent.trigger_id } })).structuredContent.status, 'failed');
  assert.equal((await broker({ tool: 'deny', arguments: {} })).isError, true);
  assert.equal((await broker({ tool: 'err', arguments: {} })).structuredContent.code, 'oops');
  assert.equal(await Promise.race([broker({ tool: 'wait', arguments: {} }).then(() => 'settled'), Promise.resolve('pending')]), 'pending');
});
test('metric batches resolve each canned read independently', async () => {
  const broker = createFixtureBroker({ entries: [1, 2].map(n => ({ tool: 'query_metrics', match: { name: `m${n}` }, response: { data: { rows: [{ value: n }] } } })), viewer: {}, isWrite: () => false, admission: () => null });
  assert.deepEqual((await broker({ tool: 'query_metrics', arguments: { reads: [{ name: 'm1' }, { name: 'm2' }] } })).structuredContent.results.map(x => x.result.rows[0].value), [1, 2]);
});
test('bundle and hostile fixture text are inert; only the exact host script is admitted', () => {
  const payload = { html: '</script><script>ATTACK()</script>', entries: [{ data: '<!--\u2028\u2029&' }] };
  assert(!inertJson(payload).includes('<'));
  assert.deepEqual(JSON.parse(inertJson(payload)), payload);
  const document = fixtureDocument(payload);
  assert.equal((document.match(/<script>/g) ?? []).length, 1); assert(!document.includes('ATTACK()</script>'));
  assert(document.includes("connect-src 'none'")); assert(document.includes("script-src 'sha256-"));
});
test('every template ships a strict fixture with four states and every declared read', () => {
  const root = new URL('../skills/author-a-surface/templates/', import.meta.url);
  const templates = readdirSync(root).filter(n => n.endsWith('.template.json')); assert.equal(templates.length, 8);
  for (const name of templates) {
    const template = JSON.parse(readFileSync(new URL(name, root)));
    const fixture = FixtureSchema.parse(JSON.parse(readFileSync(new URL(name.replace('.template.json', '.fixture.json'), root))));
    const tools = JSON.parse(Object.entries(template.files).find(([p]) => p.endsWith('tools.json'))[1]).tools;
    for (const state of ['populated', 'empty', 'loading', 'error']) for (const { tool } of tools.filter(t => t.tool !== 'automation_run_status')) assert(fixture.states[state].some(e => e.tool === tool), `${name}: ${state}: ${tool}`);
  }
});
// fetch refuses to send a caller-chosen Host header, so a DNS-rebinding request is made with node:http.
function statusWithHost(url, host) {
  return new Promise((resolve, reject) => {
    const req = request(url, { headers: { Host: host } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.once('error', reject); req.end();
  });
}
test('loopback serves generated pages only and rejects foreign Host', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'fixture-http-')); writeFileSync(join(dir, 'populated.html'), 'Sample');
  let host;
  try { host = await serveFixtures(dir); } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    if (error.code === 'EPERM') { t.skip('Harness denies loopback bind; run in unrestricted verification'); return; }
    throw error;
  }
  const { server, origin } = host;
  try { assert.equal(await (await fetch(origin + '/populated.html?theme=dark')).text(), 'Sample'); assert.equal((await fetch(origin + '/secret')).status, 404); assert.equal(await statusWithHost(origin + '/populated.html', 'example.com'), 403); }
  finally { server.closeAllConnections(); await new Promise(r => server.close(r)); rmSync(dir, { recursive: true, force: true }); }
});
test('argument parsing and named backend refusal never create renders', async () => {
  assert.throws(() => parseRenderArgs(['../bad'])); assert.throws(() => parseRenderArgs(['queue', '--state']));
  const dir = scratch();
  try { const result = await render({ cwd, argv: ['work-queue', '--dir', dir], fetchImpl: fetcher([], { ok: false, code: 'surface_render_busy', message: 'Busy', hint: 'Try later', request_id: 'request', retryable: true }) }); assert.equal(result.code, 'surface_render_busy'); assert(!result.scratch); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});
test('renamed template keeps its original synthetic fixture; unknown Surface scaffolds declared tools', () => {
  assert.equal(scaffoldFixture('renamed', [], "<SurfaceApp info={{ name: 'rtl-hebrew', version: '1' }}>").context.direction, 'rtl');
  const generic = FixtureSchema.parse(scaffoldFixture('custom-page', [{ tool: 'custom_read' }]));
  assert.deepEqual(generic.states.empty[0], { tool: 'custom_read', response: { data: { rows: [], total: 0 } } });
});
test('default writes log success, explicit refusal reconciles zero rows, and conversation outcomes are typed', async () => {
  const writes = [];
  const broker = createFixtureBroker({ viewer: {}, isWrite: () => true, admission: tool => tool.startsWith('conversation_') ? 'conversation_command' : 'automation', onWrite: (...entry) => writes.push(entry), entries: [
    { tool: 'refuse', response: { write: 'refused' } },
    { tool: 'conversation_refuse', response: { write: 'refused' } },
    { tool: 'conversation_apply', response: { write: 'success' } },
  ] });
  const first = await broker({ tool: 'write', arguments: {} });
  assert.equal((await broker({ tool: 'automation_run_status', arguments: { trigger_id: first.structuredContent.trigger_id } })).structuredContent.rowsAffected, 1);
  const refused = await broker({ tool: 'refuse', arguments: {} });
  assert.equal((await broker({ tool: 'automation_run_status', arguments: { trigger_id: refused.structuredContent.trigger_id } })).structuredContent.rowsAffected, 0);
  assert.deepEqual((await broker({ tool: 'conversation_refuse', arguments: {} })).structuredContent, { outcome: 'refused', reason: 'not_owner' });
  assert.deepEqual((await broker({ tool: 'conversation_apply', arguments: {} })).structuredContent, { outcome: 'applied' });
  assert.equal(writes[0][1].write, 'success');
});

// Templates keep their REPLACE_WITH_ placeholders; a fixture may name one only to match a call.
test('reference fixtures populate rendered fields without placeholder page text', () => {
  const root = new URL('../skills/author-a-surface/templates/', import.meta.url);
  for (const name of readdirSync(root).filter(n => n.endsWith('.template.json'))) {
    const template = JSON.parse(readFileSync(new URL(name, root)));
    const fixture = FixtureSchema.parse(JSON.parse(readFileSync(new URL(name.replace('.template.json', '.fixture.json'), root))));
    assert(!JSON.stringify(fixture, (key, value) => (key === 'match' ? undefined : value)).match(/REPLACE/i), name);
    if (name === 'record-form.template.json') assert.equal(fixture.context.query.id, fixture.states.populated.find(e => e.tool === 'knowledge_query').response.data.entities[0].id);
    for (const [path, source] of Object.entries(template.files).filter(([path]) => path.endsWith('.tsx'))) {
      const executable = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      assert(!/<Badge[^>]*>[\s\S]*?<\/Badge>/.test(executable), 'Badge labels must use the label prop');
    }
    for (const entry of fixture.states.populated) {
      const data = entry.response.data;
      if (!data?.rows) continue;
      if (entry.tool !== 'knowledge_entity_schema' && entry.match?.name !== 'REPLACE_WITH_TARGET_METRIC') assert(data.rows.length > 1, name + ': ' + entry.tool);
      for (const row of data.rows) {
        if (entry.tool === 'query_metrics') { assert.equal(typeof row.label, 'string'); assert(row.label.length > 0); assert.equal(typeof row.value, 'number'); }
        if (entry.tool.endsWith('knowledge_advanced_query')) for (const field of ['name', 'stage', 'updated_at']) assert(row[field], name + ': ' + field);
        if (entry.tool.endsWith('knowledge_aggregate')) { assert(row.group); assert(row.count > 0); }
        if (entry.tool.endsWith('entity_history')) for (const field of ['kind', 'summary', 'occurred_at', 'actor_type']) assert(row[field], name + ': ' + field);
      }
    }
  }
});
test('fixture host frames the Surface with the portal shell page padding', () => {
  const html = fixtureDocument({ html: '' });
  assert(html.includes('padding:calc(var(--spacing) * 6) calc(var(--spacing) * 8) calc(var(--spacing) * 12)'));
});
test('hidden renders cannot settle until visible paint frames, including pending fixtures', () => {
  let listener; let nextId = 0;
  const callbacks = new Map(); const states = [];
  const document = { hidden: true, addEventListener(_name, fn) { listener = fn; }, removeEventListener(_name, fn) { assert.equal(listener, fn); listener = null; } };
  const view = { requestAnimationFrame(fn) { const id = ++nextId; callbacks.set(id, fn); return id; }, cancelAnimationFrame(id) { callbacks.delete(id); } };
  const tick = () => { const work = [...callbacks.values()]; callbacks.clear(); work.forEach(fn => fn()); };
  const paint = createFixturePaint(document, view, state => states.push(FixtureRenderStateSchema.parse(state)));
  for (const state of ['settled', 'pending-by-fixture']) {
    paint.update(state); assert.equal(states.at(-1), 'hidden'); assert.equal(callbacks.size, 0);
    document.hidden = false; listener(); assert.equal(states.at(-1), 'painting');
    tick(); assert.equal(states.at(-1), 'painting'); tick(); assert.equal(states.at(-1), state);
    document.hidden = true; listener(); assert.equal(states.at(-1), 'hidden');
  }
  document.hidden = false; listener(); tick();
  paint.update('answering'); tick(); assert.equal(states.at(-1), 'answering');
  paint.update('settled'); tick(); document.hidden = true; listener(); tick(); assert.equal(states.at(-1), 'hidden');
  paint.update('host-error'); assert.equal(states.at(-1), 'host-error');
  paint.dispose(); assert.equal(listener, null); assert.equal(callbacks.size, 0);
  for (const state of FIXTURE_RENDER_STATES) assert(FixtureRenderStateSchema.safeParse(state).success);
});
