#!/usr/bin/env node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fork } from 'node:child_process';
import { FixtureSchema } from '../lib/fixture-schema.generated.mjs';
import { parseFixtureJson } from '../lib/fixture-json.mjs';
import { fixtureDocument } from '../lib/fixture-document.mjs';
import { serveFixtures } from '../lib/fixture-server.mjs';
import { stablePortForSlug } from '../lib/connect.mjs';
import { assertConnectedOrg, listLocalFiles, mcpCall, readState, resolveOrgSlug, resolveWorkspaceDir, sha256Hex } from '../lib/workspace-sync.mjs';
import { push } from './cynap-push.mjs';

export function parseRenderArgs(argv) {
  const args = { surfaceId: argv[0], dir: null, state: null };
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(args.surfaceId ?? '')) throw new Error('Usage: /cynap-render <surfaceId> [--state <name>] [--dir <path>]');
  for (let i = 1; i < argv.length; i += 1) {
    const flag = argv[i];
    if (!['--state', '--dir'].includes(flag) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Invalid render argument: ${flag}`);
    args[flag.slice(2)] = argv[++i];
  }
  return args;
}
export function scaffoldFixture(surfaceId, tools, sourceText = '') {
  const original = /info=\{\{\s*name:\s*[\'"]([a-z][a-z0-9-]*)[\'"]/.exec(sourceText)?.[1];
  const templateId = original && /^[a-z][a-z0-9-]{1,39}$/.test(original) ? original : surfaceId;
  const template = new URL(`../skills/author-a-surface/templates/${templateId}.fixture.json`, import.meta.url);
  if (existsSync(template)) return parseFixtureJson(readFileSync(template, 'utf8'));
  return { context: { viewer: { role: 'owner', displayName: 'Synthetic operator' }, accent: '175 70% 35%', locale: 'en', direction: 'ltr' },
    states: Object.fromEntries(['populated', 'empty', 'loading', 'error'].map((state) => [state, tools.map(({ tool }) => ({ tool,
      response: state === 'loading' ? { pending: true } : state === 'error' ? { error: { code: 'fixture_error', message: 'Invented fixture error' } } : { data: { rows: [], total: 0 } },
    }))])) };
}
export async function render({ cwd = process.cwd(), argv = [], fetchImpl = fetch, onPhase = () => {} } = {}) {
  const args = parseRenderArgs(argv);
  const org = resolveOrgSlug({ cwd });
  const dir = resolveWorkspaceDir({ cwd, dir: args.dir, org });
  const state = readState(dir);
  if (!state) throw new Error('No .cynap/state.json — run /cynap-pull first.');
  assertConnectedOrg(state, org, dir);
  const paths = listLocalFiles(dir); // shared push walk refuses symlinks, excludes fixtures
  const prefix = `surfaces/${args.surfaceId}/`;
  const files = paths.filter((path) => path.startsWith(prefix)).map((path) => ({ path: path.slice(prefix.length), content: new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(join(dir, path))) }));
  if (!files.length) throw new Error(`Surface directory is empty: ${args.surfaceId}`);
  const fixtureDir = join(dir, prefix, '__fixtures__');
  if (existsSync(fixtureDir) && (lstatSync(fixtureDir).isSymbolicLink() || !lstatSync(fixtureDir).isDirectory())) throw new Error('Fixture directory must be a real directory');
  const fixturePath = join(fixtureDir, 'render.json');
  if (existsSync(fixturePath) && lstatSync(fixturePath).isSymbolicLink()) throw new Error('Fixture file must not be a symlink');
  if (!existsSync(fixturePath)) {
    const tools = JSON.parse(files.find((file) => file.path === 'tools.json')?.content ?? '{"tools":[]}').tools;
    const fixture = FixtureSchema.parse(scaffoldFixture(args.surfaceId, tools, files.find((file) => file.path === 'index.tsx')?.content));
    mkdirSync(fixtureDir, { recursive: true });
    writeFileSync(fixturePath, JSON.stringify(fixture, null, 2) + '\n', { flag: 'wx' });
    onPhase('Scaffolded synthetic-only fixtures; replace placeholders with invented data, never org rows.');
  }
  const fixture = FixtureSchema.parse(parseFixtureJson(readFileSync(fixturePath, 'utf8')));
  const names = args.state ? [args.state] : Object.keys(fixture.states);
  if (names.some((name) => !Object.hasOwn(fixture.states, name))) throw new Error(`Unknown fixture state: ${args.state}`);
  const validated = await push({ cwd, argv: ['--dir', dir, '--dry-run'], fetchImpl, onPhase });
  if (!validated.ok) return validated;
  const timer = setTimeout(() => onPhase('Fixture build exceeds 10 seconds; waiting for the platform deadline.'), 10000);
  let built;
  try { built = await mcpCall(`http://127.0.0.1:${stablePortForSlug(org)}/mcp`, 'workspace_surface_render_build', { surfaceId: args.surfaceId, files }, { fetchImpl }); }
  finally { clearTimeout(timer); }
  if (built?.ok === false) return { ...built, message: `${built.code}: ${built.message}\n${built.hint}\nrequest_id: ${built.request_id}` };
  if (built?.ok !== true || typeof built.bundle_html !== 'string' || typeof built.bridge_protocol !== 'string' || sha256Hex(Buffer.from(built.bundle_html)) !== built.bundle_sha256) throw new Error('Invalid render build response or bundle digest');
  const routes = JSON.parse(files.find((file) => file.path === 'routes.json')?.content ?? '{}').routes;
  const route = routes?.[0];
  if (!route) throw new Error('Surface has no route');
  const scratch = mkdtempSync(join(tmpdir(), 'cynap-fixture-'));
  const pages = names.map((name) => {
    const file = `${name}.html`;
    writeFileSync(join(scratch, file), fixtureDocument({ html: built.bundle_html, bridgeProtocol: built.bridge_protocol, context: fixture.context, entries: fixture.states[name], routeInputs: routes.map((item) => ({ route: item.path, view: item.view, params: {}, query: {} })), routeInput: { route: route.path, view: route.view, params: {}, query: {} } }));
    return { state: name, file };
  });
  const tools = JSON.parse(files.find((file) => file.path === 'tools.json').content).tools;
  const missing = names.flatMap((name) => tools.filter(({ tool }) => tool !== 'automation_run_status' && !fixture.states[name].some((entry) => entry.tool === tool || entry.tool === tool.split(':')[0])).map(({ tool }) => `${name}: Missing fixture: ${tool}`));
  return { ok: true, scratch, pages, missing, request_id: built.request_id, findings: built.findings };
}
export async function main(argv = process.argv.slice(2)) {
  if (argv[0] === '--serve') {
    const { server, origin } = await serveFixtures(argv[1]);
    process.send?.({ origin });
    setTimeout(() => server.close(), 30 * 60 * 1000).unref();
    return;
  }
  const result = await render({ argv, onPhase: (message) => console.error(message) });
  if (!result.ok) { console.error(result.message); process.exitCode = 1; return; }
  const child = fork(fileURLToPath(import.meta.url), ['--serve', result.scratch], { detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  let origin;
  try {
    origin = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Fixture listener readiness timed out')), 5000);
      const finish = (fn, value) => { clearTimeout(timeout); fn(value); };
      child.once('message', ({ origin }) => finish(resolve, origin));
      child.once('error', (error) => finish(reject, error));
      child.once('exit', () => finish(reject, new Error('Fixture listener exited before readiness')));
    });
  } finally { if (child.connected) child.disconnect(); child.unref(); }
  console.log(`Fixture render, nothing was written. request_id: ${result.request_id}`);
  console.log(`Local scratch: ${result.scratch}; listener expires in 30 minutes.`);
  for (const page of result.pages) console.log(`${page.state}: ${origin}/${page.file}?theme=light&width=1280`);
  for (const message of result.missing) console.log(message);
  for (const finding of result.findings ?? []) console.log(JSON.stringify(finding));
  console.log('Missing reads are listed in each page’s labelled error panel. Check the visible page before taking screenshots.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
