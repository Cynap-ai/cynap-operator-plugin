#!/usr/bin/env node
// The Build Facts PostToolUse hook. After a handler write or `cynap-push` in a
// connected operator workspace, it injects at most a few platform build facts as Claude
// `additionalContext`, before the operator decides to preview. All logic lives in
// lib/build-facts-hook.mjs (unit-tested directly); this file is the thin stdin/stdout adapter.
//
// Fail-open: malformed stdin, a dead proxy, a slow server or any thrown error injects nothing,
// prints nothing and exits 0. A hard exit timer backs the client deadline, so the hook never runs
// into its 10 s hooks.json timeout.

import { HOOK_CLIENT_DEADLINE_MS, runBuildFactsHook } from '../lib/build-facts-hook.mjs';

setTimeout(() => process.exit(0), HOOK_CLIENT_DEADLINE_MS + 500).unref();

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  let input;
  try {
    input = JSON.parse(await readStdin());
  } catch {
    return;
  }
  const additionalContext = await runBuildFactsHook(input);
  if (additionalContext) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext } }));
  }
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
