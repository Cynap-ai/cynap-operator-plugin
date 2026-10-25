#!/usr/bin/env node
// /cynap-tools — list the tools this connection can call, or print one tool's input schema, so an
// operator never has to hand-roll a raw JSON-RPC `tools/list` to learn an argument name.

import { pathToFileURL } from 'node:url';

import { stablePortForSlug } from '../lib/connect.mjs';
import { applyGlobalFlags } from '../lib/cli-globals.mjs';
import { isProxyUnreachableError, resolveOrgSlug } from '../lib/workspace-sync.mjs';

const USAGE = 'Usage: cynap-tools.mjs [<tool-name>] [--json]';
const TOOL_NAME = /^[a-z][a-z0-9_]{0,95}$/;

export function parseToolsArgs(argv) {
  const args = { name: null, json: false };
  for (const arg of argv) {
    if (arg === '--json') args.json = true;
    else if (arg.startsWith('--') || args.name !== null || !TOOL_NAME.test(arg)) throw Object.assign(new Error(USAGE), { code: 'usage' });
    else args.name = arg;
  }
  return args;
}

/** One `tools/list` over the loopback proxy, following `nextCursor` until the list ends. */
export async function listTools({ proxyUrl, fetchImpl = fetch }) {
  const tools = [];
  let cursor;
  for (let page = 0; page < 20; page += 1) {
    const response = await fetchImpl(proxyUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: page + 1, method: 'tools/list', params: cursor ? { cursor } : {} }),
    });
    if (!response.ok) throw Object.assign(new Error(`tools/list failed: HTTP ${response.status}`), { code: `tools_list_http_${response.status}` });
    const body = await response.json();
    if (body.error) throw Object.assign(new Error(`tools/list error: ${JSON.stringify(body.error).slice(0, 300)}`), { code: 'tools_list_error' });
    tools.push(...(body.result?.tools ?? []));
    cursor = body.result?.nextCursor;
    if (!cursor) break;
  }
  return tools;
}

const firstSentence = (text) => String(text ?? '').split(/\n|(?<=\.)\s/)[0].slice(0, 160);

/** `name(required, optional?)  first sentence` — enough to pick a tool; `<tool-name>` prints the schema. */
export function formatToolList(tools) {
  return `${tools.map((tool) => {
    const props = Object.keys(tool.inputSchema?.properties ?? {});
    const required = new Set(tool.inputSchema?.required ?? []);
    const signature = props.map((key) => (required.has(key) ? key : `${key}?`)).join(', ');
    return `${tool.name}(${signature})  ${firstSentence(tool.description)}`;
  }).join('\n')}\n`;
}

export async function main(argv = process.argv.slice(2), { fetchImpl = fetch, out = process.stdout } = {}) {
  const args = parseToolsArgs(argv);
  const slug = resolveOrgSlug();
  const tools = await listTools({ proxyUrl: `http://127.0.0.1:${stablePortForSlug(slug)}/mcp`, fetchImpl });
  if (args.name) {
    const tool = tools.find((item) => item.name === args.name);
    if (!tool) throw Object.assign(new Error(`no tool named "${args.name}" on this connection; run cynap-tools.mjs with no name to list them`), { code: 'tool_not_found' });
    out.write(`${JSON.stringify(args.json ? tool : { name: tool.name, description: tool.description, inputSchema: tool.inputSchema }, null, 2)}\n`);
    return tool;
  }
  out.write(args.json ? `${JSON.stringify(tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })))}\n` : formatToolList(tools));
  return tools;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  applyGlobalFlags(import.meta.url);
  main().catch((error) => {
    const detail = isProxyUnreachableError(error) ? 'the operator proxy is not reachable; run /cynap-status' : String(error?.message ?? error).slice(0, 400);
    process.stderr.write(`cynap-tools: failed (${error?.code ?? 'tools_failed'}): ${detail}\n`);
    process.exitCode = 1;
  });
}
