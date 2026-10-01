// hooks/pretooluse-workspace-guard.mjs — keeps an operator session's writes
// and Bash commands inside its own workspace.
//
// Runs the REAL hook script (execFileSync), feeding it the PreToolUse JSON
// shape on stdin exactly as the harness would. `HOME` is pointed at a scratch
// dir per test so the hook's own `homedir()`-based workspace-root default
// resolves under a throwaway `<fakeHome>/CynapOperator/<slug>` — never the
// real one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = join(__dirname, '..');
const HOOK_PATH = join(PLUGIN_ROOT, 'hooks', 'pretooluse-workspace-guard.mjs');

const scratchDirs = [];
function scratchDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
}

test.after(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
});

/** A fresh fake `$HOME` with `CynapOperator/<slug>` materialized on disk (the
 * guard resolves symlinks/`..` against real paths, so the workspace must
 * actually exist for a meaningful in/out check). */
function makeFakeHome(slug = 'acme-org') {
  const home = scratchDir('cynap-guard-home-');
  const workspace = join(home, 'CynapOperator', slug);
  mkdirSync(workspace, { recursive: true });
  return { home, workspace };
}

function runHook(input, { home } = {}) {
  return execFileSync('node', [HOOK_PATH], {
    env: { ...process.env, HOME: home ?? process.env.HOME },
    input: JSON.stringify(input),
    encoding: 'utf8',
  });
}

function isDeny(stdout) {
  if (!stdout) return false;
  const parsed = JSON.parse(stdout);
  return parsed?.hookSpecificOutput?.permissionDecision === 'deny';
}

test('a non-string Bash command is not a guard crash', () => {
  const { home, workspace } = makeFakeHome();
  const stdout = runHook({ cwd: workspace, tool_name: 'Bash', tool_input: { command: { not: 'a string' } } }, { home });
  assert.equal(isDeny(stdout), false);
});

test('a Write inside the workspace is allowed', () => {
  const { home, workspace } = makeFakeHome();
  const stdout = runHook(
    { cwd: workspace, tool_name: 'Write', tool_input: { file_path: join(workspace, 'notes.md') } },
    { home }
  );
  assert.equal(stdout, '');
});

test('a Write outside the workspace is denied, naming the operator route', () => {
  const { home, workspace } = makeFakeHome();
  const outsidePath = join(home, 'elsewhere.md');
  const stdout = runHook({ cwd: workspace, tool_name: 'Write', tool_input: { file_path: outsidePath } }, { home });
  assert.ok(isDeny(stdout), `expected a deny, got: ${stdout}`);
  const reason = JSON.parse(stdout).hookSpecificOutput.permissionDecisionReason;
  assert.match(reason, /cynap-operator:cynap-push/);
  assert.match(reason, /cynap-activate/);
  assert.match(reason, /write target outside workspace/);
  assert.match(reason, /elsewhere\.md/);
  assert.match(reason, /Allowed:/);
  assert.doesNotMatch(reason.toLowerCase(), /checkout|clone|monorepo/);
});

test('Edit and MultiEdit outside the workspace are denied the same way as Write', () => {
  const { home, workspace } = makeFakeHome();
  const outsidePath = join(home, 'other.md');
  for (const toolName of ['Edit', 'MultiEdit', 'NotebookEdit']) {
    const stdout = runHook({ cwd: workspace, tool_name: toolName, tool_input: { file_path: outsidePath } }, { home });
    assert.ok(isDeny(stdout), `${toolName}: expected a deny, got: ${stdout}`);
  }
});

test('a write into the shared scratchpad is allowed even though it is outside the workspace', () => {
  const { home, workspace } = makeFakeHome();
  const scratchpad = '/private/tmp/claude-999999/some-session/scratchpad';
  const stdout = runHook(
    { cwd: workspace, tool_name: 'Write', tool_input: { file_path: join(scratchpad, 'out.txt') } },
    { home }
  );
  assert.equal(stdout, '');
});

test('a Bash command that runs git is denied', () => {
  const { home, workspace } = makeFakeHome();
  const stdout = runHook({ cwd: workspace, tool_name: 'Bash', tool_input: { command: 'git status' } }, { home });
  assert.ok(isDeny(stdout), `expected a deny, got: ${stdout}`);
  assert.match(JSON.parse(stdout).hookSpecificOutput.permissionDecisionReason, /git\/gh command: "git"/);
});

test('a Bash command that runs gh is denied', () => {
  const { home, workspace } = makeFakeHome();
  const stdout = runHook({ cwd: workspace, tool_name: 'Bash', tool_input: { command: 'gh pr create --title x' } }, { home });
  assert.ok(isDeny(stdout));
});

test('git hidden behind a cd chain is still denied', () => {
  const { home, workspace } = makeFakeHome();
  const stdout = runHook(
    { cwd: workspace, tool_name: 'Bash', tool_input: { command: 'cd /tmp && git clone https://example.com/x.git' } },
    { home }
  );
  assert.ok(isDeny(stdout));
});

test('a command word after an allowed cd is denied with the matched rule', () => {
  const { home, workspace } = makeFakeHome();
  const stdout = runHook(
    { cwd: workspace, tool_name: 'Bash', tool_input: { command: 'cd . && git push' } },
    { home }
  );
  assert.ok(isDeny(stdout));
  assert.match(JSON.parse(stdout).hookSpecificOutput.permissionDecisionReason, /git\/gh command: "git"/);
});

test('every way of spelling a git/gh invocation is denied', () => {
  const { home, workspace } = makeFakeHome();
  const denied = [
    'echo `git push`',
    'env git push',
    'command git push',
    'FOO=1 git push',
    '/usr/bin/git push',
    'bash -c "git push"',
    '{ git push; }',
    'if true; then git push; fi',
    'sudo gh pr create',
    'time git push',
    'xargs git',
    'echo "git changed"',
  ];
  for (const command of denied) {
    const stdout = runHook({ cwd: workspace, tool_name: 'Bash', tool_input: { command } }, { home });
    assert.ok(isDeny(stdout), `expected a deny for: ${command}`);
    assert.match(JSON.parse(stdout).hookSpecificOutput.permissionDecisionReason, /git\/gh command: "(git|gh)"/);
  }
});

test('a benign Bash command inside the workspace is allowed', () => {
  const { home, workspace } = makeFakeHome();
  const stdout = runHook({ cwd: workspace, tool_name: 'Bash', tool_input: { command: 'ls -la && cat README.md' } }, { home });
  assert.equal(stdout, '');
});

test('cd to a path outside the workspace is denied', () => {
  const { home, workspace } = makeFakeHome();
  const stdout = runHook({ cwd: workspace, tool_name: 'Bash', tool_input: { command: 'cd /etc && ls' } }, { home });
  assert.ok(isDeny(stdout));
});

// The three false denials observed 2026-09-29 in a acme-clinic-uk operator
// session and its Workflow lanes, replayed in their real shapes.
test('cd into the scratchpad root (no trailing slash) is allowed', () => {
  const { home, workspace } = makeFakeHome();
  const command = "cd /private/tmp/claude-999999 && cat > s.py <<'EOF'\nprint(1)\nEOF\npython3 s.py";
  assert.equal(runHook({ cwd: workspace, tool_name: 'Bash', tool_input: { command } }, { home }), '');
});

test('cd into the workspace followed by `;` is allowed', () => {
  const { home, workspace } = makeFakeHome();
  const command = `cd ${workspace}; for f in a b; do cmp -s x/$f y/$f && echo same || echo changed; done`;
  assert.equal(runHook({ cwd: workspace, tool_name: 'Bash', tool_input: { command } }, { home }), '');
});

test('a cat heredoc into the workspace whose prose mentions git or `->` is allowed', () => {
  const { home, workspace } = makeFakeHome();
  const command = `cat > ${join(workspace, 'status.md')} <<'EOF'\n# Status\n- checks is git-only; plugin 0.19.13 -> 0.19.14\n- see \`workspace_receipts {"commit":"<sha>"}\` > /etc/x\nEOF`;
  assert.equal(runHook({ cwd: workspace, tool_name: 'Bash', tool_input: { command } }, { home }), '');
});

test('the guardrail holds: repo paths, git, and shell-fed heredocs stay denied', () => {
  const { home, workspace } = makeFakeHome();
  const repo = join(home, 'code', 'cynap-monorepo-next');
  const denied = [
    `cd ${repo}; ls`,
    `cd ${repo}&&ls`,
    `cat > ${join(repo, 'x.md')} <<'EOF'\nhello\nEOF`,
    `echo hi > ${repo}/x.md;`,
    "bash <<'EOF'\ngit push\nEOF",
    "cat <<'EOF' | sh\ngit push\nEOF",
    "cat > s.sh <<'EOF'\nx\nEOF\ngit status",
    'cd /private/tmp && git status',
  ];
  for (const command of denied) {
    const stdout = runHook({ cwd: workspace, tool_name: 'Bash', tool_input: { command } }, { home });
    assert.ok(isDeny(stdout), `expected a deny for: ${command}`);
  }
  const writeStdout = runHook(
    { cwd: workspace, tool_name: 'Write', tool_input: { file_path: join(repo, 'apps', 'x.ts') } },
    { home }
  );
  assert.ok(isDeny(writeStdout), 'a Write into the monorepo must stay denied');
});

test('a Write from a subagent whose cwd is a nested workspace dir reaches the scratchpad', () => {
  const { home, workspace } = makeFakeHome();
  const nested = join(workspace, 'merge-lane');
  mkdirSync(nested, { recursive: true });
  const stdout = runHook(
    {
      cwd: nested,
      tool_name: 'Write',
      tool_input: { file_path: '/private/tmp/claude-999999/-Users-x-CynapOperator-acme-org/sid/scratchpad/lane-a/out.json' },
    },
    { home }
  );
  assert.equal(stdout, '');
});

test('a monorepo (non-operator) cwd is a total no-op', () => {
  const { home } = makeFakeHome();
  const monorepoCwd = scratchDir('cynap-guard-monorepo-');
  const outputs = [
    runHook({ cwd: monorepoCwd, tool_name: 'Bash', tool_input: { command: 'git status' } }, { home }),
    runHook({ cwd: monorepoCwd, tool_name: 'Write', tool_input: { file_path: '/etc/passwd' } }, { home }),
  ];
  for (const stdout of outputs) assert.equal(stdout, '');
});

test('malformed stdin fails open (no output, exit 0)', () => {
  const { home, workspace } = makeFakeHome();
  const stdout = execFileSync('node', [HOOK_PATH], {
    env: { ...process.env, HOME: home },
    input: 'not json at all {{{',
    encoding: 'utf8',
  });
  assert.equal(stdout, '');
  void workspace;
});

test('empty stdin fails open (no output, exit 0)', () => {
  const stdout = execFileSync('node', [HOOK_PATH], {
    env: { ...process.env },
    input: '',
    encoding: 'utf8',
  });
  assert.equal(stdout, '');
});

test('a Bash tool_input missing "command" fails open rather than throwing', () => {
  const { home, workspace } = makeFakeHome();
  const stdout = runHook({ cwd: workspace, tool_name: 'Bash', tool_input: {} }, { home });
  assert.equal(stdout, '');
});

test('a Write tool_input missing "file_path" fails open rather than throwing', () => {
  const { home, workspace } = makeFakeHome();
  const stdout = runHook({ cwd: workspace, tool_name: 'Write', tool_input: {} }, { home });
  assert.equal(stdout, '');
});

// Syntax sanity: a hook that exits non-zero on its own parse error would
// BLOCK every matching tool call (PreToolUse deny == the hard-block shape),
// so a broken guard must crash open, never closed.
test('the hook process always exits 0, even on malformed input', () => {
  assert.doesNotThrow(() => {
    execFileSync('node', [HOOK_PATH], { input: '{{{not json', encoding: 'utf8' });
  });
});
