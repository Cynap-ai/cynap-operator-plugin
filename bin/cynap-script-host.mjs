// The sandboxed side of /cynap-run-script. It runs inside `node --permission` (see
// lib/sandboxed-node.mjs), imports the operator script, and calls its default export with
// `{ mcp, org, args }`. `mcp` holds NO credential: each call is a message to the parent runner,
// which owns the read-only token and makes the network request itself.
//
// argv: <absolute script path> <JSON {org, args}>
// Zero dependencies — Node built-ins only.

import { pathToFileURL } from 'node:url';

const [scriptPath, contextJson] = process.argv.slice(2);
const { org, args } = JSON.parse(contextJson ?? '{}');

let nextId = 0;
const pending = new Map();

process.on('message', (message) => {
  if (message?.type !== 'result') return;
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  if (message.ok) waiter.resolve(message.value);
  else waiter.reject(new Error(message.error));
});

function ask(payload) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    process.send({ ...payload, id });
  });
}

const mcp = Object.freeze({
  call: (name, callArgs = {}) => ask({ type: 'call', name, args: callArgs }),
  listTools: () => ask({ type: 'list' }),
});

function finish(payload, code) {
  process.send({ type: 'done', ...payload }, () => {
    process.disconnect();
    process.exitCode = code;
  });
}

function jsonSafe(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

try {
  const mod = await import(pathToFileURL(scriptPath).href);
  if (typeof mod.default !== 'function') {
    throw new Error('an operator script must `export default async function ({ mcp, org, args }) { … }`');
  }
  const value = await mod.default({ mcp, org, args: Object.freeze([...(args ?? [])]) });
  finish({ ok: true, value: jsonSafe(value) }, 0);
} catch (error) {
  finish({ ok: false, error: error instanceof Error ? (error.stack ?? error.message) : String(error) }, 1);
}
