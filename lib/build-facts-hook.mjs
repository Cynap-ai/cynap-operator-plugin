// The Build Facts PostToolUse hook's mechanics, behind the thin stdin/stdout
// adapter hooks/posttooluse-build-facts.mjs (unit-tested directly here).
//
// After a handler write (Write/Edit/MultiEdit on a handler source or config under `automations/`)
// or a `cynap-push` command, it asks the server for the `post_write` facts that match the handler's
// mode and declared tools, and returns them as Claude `additionalContext`. Facts therefore land
// before the operator decides to preview.
//
// Contract (spec §"The plugin hook"):
//   - It POSTs `tools/call build_facts_query` with `channel: post_write` to the proxy's existing
//     loopback `/mcp` forward. There is no new proxy route, and the SERVER decides claim plus Stated
//     intent: without a claimed Request whose intent is recorded the answer is not
//     `served`, and the hook injects nothing.
//   - It aborts its own request at HOOK_CLIENT_DEADLINE_MS, below the 10 s hook timeout; the
//     server's `post_write_deadline_ms` is shorter still (a parity test pins the order).
//   - Fail-open: any fault injects nothing and echoes no error. Outside a connected operator
//     workspace it makes no network call at all.
//   - It never re-injects a fact id it already injected in the same session.
//   - Its output names the policy version, so a fact replayed on resume can be recognized.
// A `served` line therefore records a server return, not delivery to the model.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { resolveWorkspaceRoot } from './workspace-guard.mjs';
import { mcpCall, RESERVED_DIR, STATE_REL_PATH, writeFileAtomic } from './workspace-sync.mjs';

/** The client deadline: below the hooks.json timeout, above the server's post_write deadline. */
export const HOOK_CLIENT_DEADLINE_MS = 6000;

/** The post_write channel's server-side cap; the hook never injects more in one turn. */
export const HOOK_MAX_FACTS = 3;

/** The args schema's own bound on `tools` (`query-args.ts`). */
const MAX_TOOLS = 32;
/** A push re-reads every handler config; this bounds the calls one push can make. */
const MAX_PUSH_CONTEXTS = 3;
/** Sessions kept in the dedupe record; older ones are dropped. */
const MAX_SESSIONS = 20;

export const INJECTED_REL_PATH = `${RESERVED_DIR}/build-facts-hook.json`;

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit']);
const PUSH_COMMAND = /(?:^|[\s/"'])cynap-push(?:\.mjs)?(?=$|[\s"'])/u;
const NESTED_HANDLER = /^automations\/handlers\/([^/.]+)\/(?:handler\.ts|config\.json)$/u;
const FLAT_HANDLER = /^automations\/([^/.]+)\.(?:ts|json)$/u;

/** The handler id a workspace-relative path belongs to, or null when it is not a handler file. */
export function handlerIdOf(relPath) {
  const path = relPath.split(sep).join('/');
  return NESTED_HANDLER.exec(path)?.[1] ?? FLAT_HANDLER.exec(path)?.[1] ?? null;
}

export function isPushCommand(command) {
  return typeof command === 'string' && PUSH_COMMAND.test(command);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** The handler's `execution.mode` and declared tools, from its nested config (which wins) or its flat one. */
export function readHandlerContext(workspaceDir, id) {
  const config =
    readJson(join(workspaceDir, 'automations', 'handlers', id, 'config.json')) ?? readJson(join(workspaceDir, 'automations', `${id}.json`));
  if (typeof config !== 'object' || config === null) return null;
  // A handler config keeps its mode under `execution`, beside `allowed_tools`; a top-level `mode` is not a mode.
  const mode = typeof config.execution?.mode === 'string' ? config.execution.mode : null;
  const declared = Array.isArray(config.execution?.allowed_tools) ? config.execution.allowed_tools : [];
  const tools = [...new Set(declared.filter((tool) => typeof tool === 'string' && tool.length > 0 && tool.length <= 128))].slice(0, MAX_TOOLS);
  if (mode === null && tools.length === 0) return null;
  return { ...(mode === null ? {} : { mode }), ...(tools.length === 0 ? {} : { tools }) };
}

/** Every handler id in the workspace: nested handler dirs and flat `automations/<id>.ts`. */
function listHandlerIds(workspaceDir) {
  const ids = new Set();
  const nested = join(workspaceDir, 'automations', 'handlers');
  if (existsSync(nested)) {
    for (const entry of readdirSync(nested, { withFileTypes: true })) if (entry.isDirectory()) ids.add(entry.name);
  }
  const flat = join(workspaceDir, 'automations');
  if (existsSync(flat)) {
    for (const entry of readdirSync(flat, { withFileTypes: true })) {
      const id = entry.isFile() ? handlerIdOf(`automations/${entry.name}`) : null;
      if (id !== null) ids.add(id);
    }
  }
  return [...ids].sort();
}

/** A push: one context per mode, with the union of that mode's declared tools. */
function pushContexts(workspaceDir) {
  const byMode = new Map();
  for (const id of listHandlerIds(workspaceDir)) {
    const ctx = readHandlerContext(workspaceDir, id);
    if (!ctx) continue;
    const key = ctx.mode ?? '';
    byMode.set(key, new Set([...(byMode.get(key) ?? []), ...(ctx.tools ?? [])]));
  }
  return [...byMode.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, MAX_PUSH_CONTEXTS)
    .map(([mode, tools]) => ({ ...(mode ? { mode } : {}), ...(tools.size ? { tools: [...tools].slice(0, MAX_TOOLS) } : {}) }));
}

/** The nearest ancestor of `start` holding `.cynap/state.json`, never above the workspace root. */
function findWorkspaceDir(start, workspaceRoot) {
  for (let dir = resolve(start); ; dir = dirname(dir)) {
    if (dir !== workspaceRoot && !dir.startsWith(`${workspaceRoot}${sep}`)) return null;
    if (existsSync(join(dir, STATE_REL_PATH))) return dir;
    if (dir === workspaceRoot || dir === dirname(dir)) return null;
  }
}

/** The proxy's loopback `/mcp` URL, from the workspace's own `.mcp.json`, or null when not connected. */
export function proxyUrlOf(workspaceRoot) {
  const url = readJson(join(workspaceRoot, '.mcp.json'))?.mcpServers?.['cynap-operator']?.url;
  if (typeof url !== 'string') return null;
  try {
    const parsed = new URL(url);
    const loopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
    return parsed.protocol === 'http:' && loopback && parsed.pathname === '/mcp' ? parsed.href : null;
  } catch {
    return null;
  }
}

/**
 * What one PostToolUse event asks for: the proxy URL, the workspace dir and the handler contexts.
 * Null when the event is not a handler write or a push inside a connected operator workspace.
 */
export function planHook(input, { operatorRoot = join(homedir(), 'CynapOperator') } = {}) {
  if (typeof input !== 'object' || input === null) return null;
  const workspaceRoot = resolveWorkspaceRoot(input.cwd, operatorRoot);
  if (!workspaceRoot) return null;
  const proxyUrl = proxyUrlOf(workspaceRoot);
  if (!proxyUrl) return null;
  const toolInput = input.tool_input ?? {};

  if (WRITE_TOOLS.has(input.tool_name)) {
    if (typeof toolInput.file_path !== 'string') return null;
    const file = isAbsolute(toolInput.file_path) ? toolInput.file_path : resolve(input.cwd, toolInput.file_path);
    const workspaceDir = findWorkspaceDir(dirname(file), workspaceRoot);
    if (!workspaceDir) return null;
    const id = handlerIdOf(relative(workspaceDir, file));
    const ctx = id === null ? null : readHandlerContext(workspaceDir, id);
    return ctx ? { proxyUrl, workspaceDir, contexts: [ctx] } : null;
  }

  if (input.tool_name === 'Bash' && isPushCommand(toolInput.command)) {
    const slug = workspaceRoot.split(sep).pop();
    const workspaceDir =
      findWorkspaceDir(input.cwd, workspaceRoot) ?? (existsSync(join(workspaceRoot, `cynap-${slug}`, STATE_REL_PATH)) ? join(workspaceRoot, `cynap-${slug}`) : null);
    if (!workspaceDir) return null;
    const contexts = pushContexts(workspaceDir);
    return contexts.length > 0 ? { proxyUrl, workspaceDir, contexts } : null;
  }
  return null;
}

/** The dedupe key of one Claude session: hashed, so the record never holds the raw session id. */
function sessionKey(sessionId) {
  return createHash('sha256').update(`build_facts.hook:${sessionId}`, 'utf8').digest('hex').slice(0, 32);
}

function readInjected(workspaceDir) {
  const record = readJson(join(workspaceDir, INJECTED_REL_PATH));
  return typeof record?.sessions === 'object' && record.sessions !== null ? record.sessions : {};
}

/** Record the ids injected in this session, keeping only the most recent sessions. */
function writeInjected(workspaceDir, sessions, key, ids, now) {
  const merged = { ...sessions, [key]: { ids: [...new Set([...(sessions[key]?.ids ?? []), ...ids])], at: new Date(now).toISOString() } };
  const kept = Object.entries(merged)
    .sort(([, a], [, b]) => String(b.at).localeCompare(String(a.at)))
    .slice(0, MAX_SESSIONS);
  writeFileAtomic(join(workspaceDir, INJECTED_REL_PATH), Buffer.from(`${JSON.stringify({ sessions: Object.fromEntries(kept) }, null, 2)}\n`, 'utf8'));
}

/** The text the model sees. Facts are platform mechanics, not instructions. */
export function formatBuildFacts(facts, policyVersion) {
  const lines = facts.map((fact) => {
    const remedy = fact.remedy ? ` Remedy: ${fact.remedy}` : '';
    const enforced = fact.enforced_by ? ` Enforced by ${fact.enforced_by}.` : '';
    return `- ${fact.id}: ${fact.rule}${remedy}${enforced}`;
  });
  return [
    `Cynap Build Facts for the handler you just changed (policy ${String(policyVersion).slice(0, 12)}):`,
    ...lines,
    'Vote on one with build_facts_query {vote: {fact_id, verdict: useful | wrong | missing_context, vote_id: <a fresh UUID>}}.',
  ].join('\n');
}

const isFact = (fact) => typeof fact?.id === 'string' && typeof fact.rule === 'string';

/**
 * Run one PostToolUse event. Returns the additionalContext text, or null to inject nothing.
 * Never throws: every fault is a silent null.
 */
export async function runBuildFactsHook(input, { fetchImpl = fetch, now = Date.now, operatorRoot, deadlineMs = HOOK_CLIENT_DEADLINE_MS } = {}) {
  // A ref'd timer, not AbortSignal.timeout(): its unref'd timer lets a hung request drain the event
  // loop before the deadline fires, so the hook would exit mid-await instead of answering null.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('build facts hook deadline')), deadlineMs);
  try {
    const plan = planHook(input, operatorRoot ? { operatorRoot } : {});
    if (!plan) return null;
    const timedFetch = (url, init) => fetchImpl(url, { ...init, signal: controller.signal });
    const answers = await Promise.all(
      plan.contexts.map((ctx) =>
        mcpCall(plan.proxyUrl, 'build_facts_query', { ...ctx, channel: 'post_write' }, { fetchImpl: timedFetch }).catch(() => null)
      )
    );
    const served = answers.filter((answer) => answer?.outcome === 'served' && Array.isArray(answer.facts));
    if (served.length === 0) return null;

    const sessions = readInjected(plan.workspaceDir);
    const key = sessionKey(typeof input.session_id === 'string' ? input.session_id : '');
    const seen = new Set(sessions[key]?.ids ?? []);
    const fresh = [];
    for (const fact of served.flatMap((answer) => answer.facts)) {
      if (!isFact(fact) || seen.has(fact.id)) continue;
      seen.add(fact.id);
      fresh.push(fact);
    }
    const facts = fresh.slice(0, HOOK_MAX_FACTS);
    if (facts.length === 0) return null;
    writeInjected(plan.workspaceDir, sessions, key, facts.map((fact) => fact.id), now());
    return formatBuildFacts(facts, served[0].policy_version);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
