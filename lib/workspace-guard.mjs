#!/usr/bin/env node
// PreToolUse workspace guardrail — pure/testable mechanics behind
// hooks/pretooluse-workspace-guard.mjs.
//
// Why this exists: an operator session's working directory is a plain
// checkout with no git remote, produced by /cynap-pull. It has no route to
// ship a source change through git/GitHub, and it must never improvise one by
// falling back to a full checkout elsewhere on the machine. Left to its own
// judgment, a session facing a change with no operator command for it will
// reach for git anyway — which is exactly the failure this guard closes: it
// makes that reach impossible rather than merely discouraged.
//
// Fires for EVERY session (installed at user scope), so the workspace-root
// gate below is what keeps it inert for every non-operator session. Detection
// reuses the same base directory the connect flow materializes workspaces
// under, resolved from the hook's own `cwd` — never a heuristic over file
// contents.
//
// Fail-open on anything this module cannot confidently classify: a thrown
// error, a missing field, an unresolvable path. A broken guard must never
// block a real tool call — see the CLI entry point for the exception boundary.

import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

// Kept in lockstep with the connect flow's own base-dir constant (that module
// cannot be imported here without pulling in its network/process-spawn
// surface — see that module's own note on the same duplication).
const OPERATOR_WORKDIR_BASE = 'CynapOperator';

const WRITE_TOOL_NAMES = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

const DENY_REASON =
  'This is an operator workspace session — it must stay inside its workspace. Operator sessions ' +
  'ship through /cynap-operator:cynap-push and /cynap-activate. If this change (handler source, a ' +
  'check, anything else) has no operator route, that is a founder decision: stop and ask a human ' +
  'rather than reaching for git/gh or a path outside the workspace.';

/** The `~/CynapOperator/<slug>` ancestor of `cwd`, or null when `cwd` is not
 * inside `operatorRoot` at all (a monorepo session, or any other project). */
export function resolveWorkspaceRoot(cwd, operatorRoot = join(homedir(), OPERATOR_WORKDIR_BASE)) {
  if (!cwd || typeof cwd !== 'string') return null;
  const dir = resolve(cwd);
  const root = resolve(operatorRoot);
  if (dir === root) return null; // sitting at the base dir itself, not inside a slug workspace
  const prefix = `${root}/`;
  if (!dir.startsWith(prefix)) return null;
  const slug = dir.slice(prefix.length).split('/')[0];
  return slug ? join(root, slug) : null;
}

/** Resolves symlinks and `..` for a path that may not exist yet (a Write
 * target), by realpath-ing the longest existing ancestor and rejoining the
 * rest — realpathSync itself throws on a not-yet-created file. */
function resolveEffectivePath(candidate) {
  let dir = resolve(candidate);
  const tail = [];
  for (;;) {
    try {
      const real = realpathSync.native(dir);
      return tail.length ? join(real, ...tail.reverse()) : real;
    } catch {
      const parent = dirname(dir);
      if (parent === dir) return resolve(candidate); // reached filesystem root — give up cleanly
      tail.push(basename(dir));
      dir = parent;
    }
  }
}

function isUnder(pathValue, rootValue) {
  return pathValue === rootValue || pathValue.startsWith(`${rootValue}/`);
}

// The session scratchpad (per the harness's own temp-file convention) and the
// user's own Claude Code home (plan files, memory) are legitimate write
// targets from inside an operator session and are never the workspace.
// The per-user root itself (`cd /private/tmp/claude-501`) counts too — a
// trailing-slash-only pattern refused that cd.
const SCRATCHPAD_PATTERNS = [/^\/private\/tmp\/claude-[^/]+(?:\/|$)/, /^\/tmp\/claude-[^/]+(?:\/|$)/];

/** True when `targetPath` is inside the workspace root, the shared
 * scratchpad, or the user's own Claude home — the only writable surfaces for
 * an operator session. */
export function isPathAllowed(targetPath, { workspaceRoot, home = homedir() } = {}) {
  if (!targetPath || typeof targetPath !== 'string') return true; // nothing to check — fail open
  const resolvedReal = resolveEffectivePath(targetPath);
  const resolvedRaw = resolve(targetPath);
  const candidates = [resolvedReal, resolvedRaw];

  if (workspaceRoot) {
    const wsReal = resolveEffectivePath(workspaceRoot);
    const wsRaw = resolve(workspaceRoot);
    if (candidates.some((p) => isUnder(p, wsReal) || isUnder(p, wsRaw))) return true;
  }
  if (candidates.some((p) => SCRATCHPAD_PATTERNS.some((re) => re.test(p)))) return true;

  const claudeHomeRaw = join(resolve(home), '.claude');
  const claudeHomeReal = resolveEffectivePath(claudeHomeRaw);
  if (candidates.some((p) => isUnder(p, claudeHomeRaw) || isUnder(p, claudeHomeReal))) return true;

  return false;
}

// Matches a standalone `git` or `gh` token: any subcommand, any flag shape,
// preceded by a chain operator, a subshell, an env-var assignment, or nothing
// at all. Deliberately NOT quote-aware — an operator session has no
// legitimate reason to type the word inside a string either, so treating it
// the same as a real invocation costs nothing and closes a redaction-based
// evasion for free.
const GIT_OR_GH_RE = /\b(git|gh)\b/;

export function commandMentionsGitOrGh(command) {
  if (!command || typeof command !== 'string') return false;
  return GIT_OR_GH_RE.test(stripDataHeredocs(command));
}

// A heredoc body fed to `cat`/`tee` is file CONTENT, not shell: a status note
// saying "git-only" or "a -> b" is prose, and scanning it denied an in-workspace
// write. Only that shape is dropped — a body fed to anything else (`bash <<EOF`,
// `cat <<EOF | sh`, `$(cat <<EOF)`) stays scanned, and the header line, with
// its own redirect target, is always kept.
const HEREDOC_RE = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/;
const DATA_SINK_RE = /^\s*(?:cat|tee)\b/;

function feedsDataSink(line, heredocIndex) {
  if (line.slice(heredocIndex).includes('|')) return false;
  const segment = line.slice(0, heredocIndex).split(/&&|\|\||;/).pop();
  return !segment.includes('|') && DATA_SINK_RE.test(segment);
}

export function stripDataHeredocs(command) {
  const lines = command.split('\n');
  const kept = [];
  for (let i = 0; i < lines.length; i += 1) {
    kept.push(lines[i]);
    const match = HEREDOC_RE.exec(lines[i]);
    if (!match || !feedsDataSink(lines[i], match.index)) continue;
    const delimiter = match[2];
    const end = lines.findIndex((line, j) => j > i && line.replace(/^\t+/, '') === delimiter);
    if (end === -1) continue; // unterminated: scan everything rather than guess
    kept.push(lines[end]);
    i = end;
  }
  return kept.join('\n');
}

function unquote(raw) {
  if (raw.length >= 2) {
    const first = raw[0];
    const last = raw[raw.length - 1];
    if ((first === '"' || first === "'") && first === last) return raw.slice(1, -1);
  }
  return raw;
}

// `cd <target>` after a chain operator, `then`, or `do`; and `>`/`>>` (with an
// optional leading fd number) redirect targets. Both are extracted the same
// conservative way: a quoted span, or a bare run that stops at whitespace or a
// shell operator (`cd /ws; ls` targets `/ws`, not `/ws;`). This is
// not a shell parser — it only needs to catch the two shapes the task calls
// out (a directory change, a write redirect), not every way a command could
// touch a path.
const CD_RE = /(?:^|[;&|(]|\bthen\b|\bdo\b)\s*cd\s+(?:--\s+)?("[^"]*"|'[^']*'|[^\s;&|()<>]+)/g;
const REDIRECT_RE = /(?:^|\s)\d?>{1,2}(?!=)\s*("[^"]*"|'[^']*'|[^\s;&|()<>]+)/g;

function extractCandidateTargets(command) {
  const targets = [];
  const scanned = stripDataHeredocs(command);
  for (const re of [CD_RE, REDIRECT_RE]) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(scanned)) !== null) {
      const raw = unquote(match[1]);
      if (raw) targets.push(raw);
    }
  }
  return targets;
}

/** True when a Bash command changes into, or redirects output to, a path
 * outside every allowed surface (workspace root, scratchpad, Claude home). */
export function commandTargetsOutsideWorkspace(command, { workspaceRoot, cwd, home = homedir() } = {}) {
  if (!command || typeof command !== 'string' || !workspaceRoot) return false;
  for (const raw of extractCandidateTargets(command)) {
    if (raw === '-' || raw === '.' || raw.startsWith('/dev/')) continue; // no real path, or a no-op
    let target = raw;
    if (target.startsWith('~')) {
      target = join(home, target.slice(1).replace(/^\//, ''));
    } else if (!target.startsWith('/')) {
      target = resolve(cwd || workspaceRoot, target);
    }
    if (!isPathAllowed(target, { workspaceRoot, home })) return true;
  }
  return false;
}

/** Main decision: given a parsed PreToolUse hook payload, returns `{ reason
 * }` to deny, or `null` to allow (including the no-op case of a session
 * whose `cwd` is not an operator workspace at all). Never throws — an
 * unrecognized shape is treated as nothing to check. */
export function evaluateGuard(input, { home = homedir(), operatorRoot } = {}) {
  if (!input || typeof input !== 'object') return null;
  const workspaceRoot = resolveWorkspaceRoot(input.cwd, operatorRoot);
  if (!workspaceRoot) return null;

  const toolName = input.tool_name;
  const toolInput = (input.tool_input && typeof input.tool_input === 'object') ? input.tool_input : {};

  if (WRITE_TOOL_NAMES.has(toolName)) {
    const filePath = toolInput.file_path || toolInput.notebook_path;
    if (filePath && !isPathAllowed(filePath, { workspaceRoot, home })) {
      return { reason: DENY_REASON };
    }
    return null;
  }

  if (toolName === 'Bash') {
    const command = toolInput.command || '';
    if (commandMentionsGitOrGh(command)) return { reason: DENY_REASON };
    if (commandTargetsOutsideWorkspace(command, { workspaceRoot, cwd: input.cwd, home })) {
      return { reason: DENY_REASON };
    }
    return null;
  }

  return null;
}

export { DENY_REASON, OPERATOR_WORKDIR_BASE };
