#!/usr/bin/env node
// Operator-plane PreToolUse workspace guardrail.
//
// Denies a Write/Edit/MultiEdit/NotebookEdit whose target resolves outside
// the operator workspace, and a Bash command that invokes git/gh or that
// cd's/redirects into a path outside the workspace. All matching logic lives
// in lib/workspace-guard.mjs (unit-tested directly); this file is the thin
// stdin/stdout/exit-code adapter.
//
// Behavior contract (mirrors the SessionStart hooks in this same dir):
//   - NO-OP unless the session `cwd` is inside an operator workspace — fires
//     for every PreToolUse event on the machine, so that gate is what keeps
//     it inert everywhere else.
//   - FAILS OPEN on anything unexpected: malformed stdin, an input shape this
//     module doesn't recognize, an exception anywhere in evaluation. A parse
//     error must never read as a deny — that would block every matching tool
//     call for every session, everywhere, which is worse than no guard at
//     all.
//   - A real deny is reported as `{"hookSpecificOutput": {"hookEventName":
//     "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason":
//     "…"}}` on stdout, exit 0 — never exit 2. The deny reason always names
//     the operator route, never suggests falling back to a checkout.

import { evaluateGuard } from '../lib/workspace-guard.mjs';

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  let raw = '';
  try {
    raw = await readStdin();
  } catch {
    return;
  }
  if (!raw) return;

  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return;
  }

  let result;
  try {
    result = evaluateGuard(input);
  } catch {
    return; // fail open — a bug in this guard must never block a real tool call
  }

  if (result && result.reason) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: result.reason,
        },
      })
    );
  }
}

main()
  .catch(() => {})
  .finally(() => process.exit(0));
