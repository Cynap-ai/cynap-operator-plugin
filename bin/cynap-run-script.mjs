#!/usr/bin/env node
// /cynap-run-script — runs a read-only operator script against the connected org.
//
// Contract: the script is `export default async function ({ mcp, org, args }) { … }` under
// `operator/scripts/` in a pulled working directory.
//
// The security shape (why a filter in the script's own process is not enough):
//   1. The runner mints its OWN token through the proxy's nonce-gated /script-token route, which
//      calls the portal's operator-script-token route. That route issues only `workspace:read`
//      or `workspace:read-ops`, so the server refuses every write tool the script asks for.
//   2. The token stays in THIS process. The script runs in a child `node --permission` with read
//      access to the working directory only, an empty environment, and no network — so it can not
//      reach the local proxy either. Its `mcp.call` is a message to this process, never a
//      credential. A runtime that cannot deny the network (Node < 25) is refused.
//   3. The script's org is the working directory's connected org. The proxy's org and the minted
//      token's org must both match it, or the run is refused before the script starts.
//
// Usage: node cynap-run-script.mjs [--dir <pulled dir>] <path> [args…]
// Zero dependencies — Node built-ins + sibling modules only.

import { fork } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve as resolvePath, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { resolveWorkingDir, stablePortForSlug } from '../lib/connect.mjs';
import { assertConnectedOrg, hasSymlinkOnPath, readState, resolveOrgSlug, resolveWorkspaceDir } from '../lib/workspace-sync.mjs';
import { assertNetworkGated, assertSupportedNode, SANDBOX_ENV, sandboxExecArgv } from '../lib/sandboxed-node.mjs';
import { CONTROL_FILE, CONTROL_HEADER, SCRIPT_TOKEN_PATH, upstreamHeaders } from './operator-proxy.mjs';
import { readPluginVersion } from './operator-proxy-launcher.mjs';

const HOST_PATH = join(dirname(fileURLToPath(import.meta.url)), 'cynap-script-host.mjs');
export const SCRIPTS_PREFIX = 'operator/scripts/';
const EXPECTED_SCOPE = { workspace: 'workspace:read', ops: 'workspace:read-ops' };

export function parseRunScriptArgs(argv) {
  const out = { dir: null, scriptPath: null, scriptArgs: [] };
  let i = 0;
  while (i < argv.length && argv[i].startsWith('--')) {
    if (argv[i] === '--dir') {
      out.dir = argv[i + 1];
      i += 2;
    } else {
      throw new Error(`cynap-run-script: unrecognized option "${argv[i]}"`);
    }
  }
  out.scriptPath = argv[i] ?? null;
  out.scriptArgs = argv.slice(i + 1);
  if (!out.scriptPath) throw new Error('Usage: /cynap-run-script <path> [args…]');
  return out;
}

/** Resolves the script inside the pulled working dir, refusing anything outside `operator/scripts/`. */
export function resolveScript(dir, scriptPath) {
  const abs = isAbsolute(scriptPath) ? resolvePath(scriptPath) : resolvePath(dir, scriptPath);
  const rel = relative(resolvePath(dir), abs).split(sep).join('/');
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel) || !rel.startsWith(SCRIPTS_PREFIX)) {
    throw new Error(`cynap-run-script: ${scriptPath} is not under ${SCRIPTS_PREFIX} of the working directory ${dir}`);
  }
  if (hasSymlinkOnPath(dir, abs)) throw new Error(`cynap-run-script: refusing a symlinked path: ${rel}`);
  if (!existsSync(abs) || !statSync(abs).isFile()) throw new Error(`cynap-run-script: no such script: ${rel}`);
  return abs;
}

/** Reads a JWT's payload WITHOUT verifying it — only to cross-check what the proxy returned. */
export function decodeJwtPayload(token) {
  const part = String(token).split('.')[1];
  if (!part) throw new Error('minted token is not a JWT');
  return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
}

/**
 * Asks the proxy for a read-only token of one family and checks it before anyone uses it:
 * the proxy's org must be the working directory's org, and the token's own claims must carry
 * exactly the expected read scope for that org.
 */
export async function acquireScriptToken({ org, family, proxyBase, nonce, fetchImpl = fetch }) {
  const res = await fetchImpl(`${proxyBase}${SCRIPT_TOKEN_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [CONTROL_HEADER]: nonce },
    body: JSON.stringify({ family }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.ok !== true) {
    const error = new Error(`script token (${family}) refused: ${body?.error ?? `HTTP ${res.status}`}`);
    error.status = res.status;
    throw error;
  }
  if (body.org_slug !== org) {
    throw new Error(`org mismatch: this working directory is connected to "${org}", but the proxy serves "${body.org_slug}"`);
  }
  const claims = decodeJwtPayload(body.token);
  if (claims.scope !== EXPECTED_SCOPE[family]) {
    throw new Error(`refusing a ${family} script token scoped "${claims.scope}" — only "${EXPECTED_SCOPE[family]}" is allowed`);
  }
  if (claims.org_id !== body.org_id) {
    throw new Error(`org mismatch: the minted token is for "${claims.org_id}", the proxy serves "${body.org_id}"`);
  }
  return { token: body.token, mcpUrl: body.mcp_url };
}

function decodeRpcBody(text) {
  try {
    return JSON.parse(text);
  } catch {
    const lines = text
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim());
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      try {
        return JSON.parse(lines[i]);
      } catch {
        // an SSE data line that is not the JSON-RPC envelope — keep looking
      }
    }
    return null;
  }
}

/**
 * One JSON-RPC request to the operator MCP endpoint with a script token. It reports the plugin
 * version exactly as the operator proxy does (`upstreamHeaders`), so a server that enforces a
 * minimum sees the real version and not `installed: null`.
 */
export async function rpc({ mcpUrl, token, method, params, pluginVersion, fetchImpl = fetch }) {
  const res = await fetchImpl(mcpUrl, {
    method: 'POST',
    headers: upstreamHeaders(pluginVersion, {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`,
    }),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const text = await res.text();
  const envelope = decodeRpcBody(text);
  // A refusal body that is not a JSON-RPC error (`plugin_outdated` is one) reaches the script
  // author verbatim: the code and the minimum are the whole message.
  if (!res.ok) throw new Error(`${method} HTTP ${res.status}${envelope?.error ? `: ${JSON.stringify(envelope.error)}` : text ? `: ${text.slice(0, 2000)}` : ''}`);
  if (!envelope) throw new Error(`${method}: unreadable response`);
  if (envelope.error) throw new Error(`${method} refused: ${JSON.stringify(envelope.error)}`);
  return envelope.result ?? {};
}

function toolValue(name, result) {
  if (result.isError) {
    const text = result.content?.find?.((c) => c.type === 'text')?.text ?? JSON.stringify(result);
    throw new Error(`${name} refused: ${text}`);
  }
  if (result.structuredContent) return result.structuredContent;
  const text = result.content?.find?.((c) => c.type === 'text')?.text;
  if (typeof text !== 'string') return result;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * The broker: holds the tokens, answers the child's `call`/`list` messages. A tool the ops
 * token lists goes out on the ops token; everything else on the workspace token, so a write
 * tool reaches the server and is refused THERE, by scope.
 */
export function createBroker({ workspace, ops, pluginVersion, fetchImpl = fetch }) {
  let opsTools = null;
  async function opsToolNames() {
    if (!ops) return new Set();
    if (!opsTools) {
      const listed = await rpc({ ...ops, method: 'tools/list', params: {}, pluginVersion, fetchImpl });
      opsTools = new Set((listed.tools ?? []).map((t) => t.name));
    }
    return opsTools;
  }
  return {
    async call(name, args) {
      const target = (await opsToolNames()).has(name) ? ops : workspace;
      const result = await rpc({ ...target, method: 'tools/call', params: { name, arguments: args ?? {} }, pluginVersion, fetchImpl });
      return toolValue(name, result);
    },
    async list() {
      const listed = await rpc({ ...workspace, method: 'tools/list', params: {}, pluginVersion, fetchImpl });
      const names = new Set((listed.tools ?? []).map((t) => t.name));
      for (const name of await opsToolNames()) names.add(name);
      return [...names].sort();
    },
  };
}

/** Forks the sandboxed host and serves its messages until it exits. */
export function runSandboxedScript({ dir, scriptAbs, org, scriptArgs, broker, forkImpl = fork }) {
  // Grants name REAL paths: the module loader realpaths every import, and a grant on a path
  // behind a symlink (macOS `/var` → `/private/var`) would deny the loader its own walk.
  const realDir = realpathSync(dir);
  const realHost = realpathSync(HOST_PATH);
  return new Promise((resolve) => {
    const child = forkImpl(realHost, [realpathSync(scriptAbs), JSON.stringify({ org, args: scriptArgs })], {
      cwd: realDir,
      env: SANDBOX_ENV,
      execArgv: sandboxExecArgv([realDir, realHost]),
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    let done = null;
    child.on('message', async (message) => {
      if (message?.type === 'done') {
        done = message;
        return;
      }
      if (message?.type !== 'call' && message?.type !== 'list') return;
      try {
        const value = message.type === 'list' ? await broker.list() : await broker.call(message.name, message.args);
        if (child.connected) child.send({ type: 'result', id: message.id, ok: true, value });
      } catch (error) {
        if (child.connected) {
          child.send({ type: 'result', id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      }
    });
    child.on('exit', (code) => {
      resolve({
        ok: code === 0 && done?.ok === true,
        exitCode: code,
        value: done?.value ?? null,
        error: done?.ok === false ? done.error : code === 0 ? null : `script host exited ${code}`,
      });
    });
  });
}

export async function runScript({ cwd = process.cwd(), argv = [], fetchImpl = fetch, forkImpl = fork, proxyBase, pluginVersion = readPluginVersion() } = {}) {
  assertSupportedNode();
  assertNetworkGated();
  const args = parseRunScriptArgs(argv);
  const org = resolveOrgSlug({ cwd });
  const dir = resolveWorkspaceDir({ cwd, dir: args.dir, org });
  const state = readState(dir);
  if (!state) throw new Error(`cynap-run-script: ${dir} is not a pulled working directory — run /cynap-pull first.`);
  assertConnectedOrg(state, org, dir);
  const scriptAbs = resolveScript(dir, args.scriptPath);

  const nonce = readFileSync(join(resolveWorkingDir(org), CONTROL_FILE), 'utf8').trim();
  if (!nonce) throw new Error('cynap-run-script: the local control nonce is missing — run /cynap-connect again.');
  const base = proxyBase ?? `http://127.0.0.1:${stablePortForSlug(org)}`;

  const workspace = await acquireScriptToken({ org, family: 'workspace', proxyBase: base, nonce, fetchImpl });
  let ops = null;
  try {
    ops = await acquireScriptToken({ org, family: 'ops', proxyBase: base, nonce, fetchImpl });
  } catch (error) {
    // No ops grant is a normal seat shape; the script simply has no run/journal reads. A
    // mismatch or a wrong scope is NOT normal and stops the run.
    if (error?.status !== 403) throw error;
  }

  const broker = createBroker({ workspace, ops, pluginVersion, fetchImpl });
  return runSandboxedScript({ dir, scriptAbs, org, scriptArgs: args.scriptArgs, broker, forkImpl });
}

export async function main(argv = process.argv.slice(2)) {
  let result;
  try {
    result = await runScript({ argv });
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return { ok: false };
  }
  if (!result.ok) {
    process.stderr.write(`cynap-run-script: ${result.error}\n`);
    process.exitCode = 1;
    return result;
  }
  process.stdout.write(`${JSON.stringify(result.value, null, 2)}\n`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
