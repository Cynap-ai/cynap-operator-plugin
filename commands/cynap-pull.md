---
description: Three-way sync the connected org's accepted tip into a local working directory.
argument-hint: "[--dir <path>] [--take-remote <path> ...]"
---

# /cynap-pull

```sh
node "${CLAUDE_PLUGIN_ROOT}/bin/cynap-pull.mjs" $ARGUMENTS
```

Reads `workspace_tree({commit: 'tip', include_hashes: true})` through the local operator
proxy, pins every file fetch to the returned commit sha, and three-way compares base
(`.cynap/state.json`), local (the hash on disk) and remote:

- a remote-only change is taken;
- a local-only change is kept;
- both changed to different bytes is a **conflict**.

**All-or-nothing.** Any conflict writes nothing — it lists each as `path, local sha, remote
sha` and exits non-zero. Resolve one with `--take-remote <path>` (repeatable), or edit locally
and re-run. With no conflicts, every remote-only change is written and `state.base` moves to
the pinned sha.

## Target directory

`./cynap-<org>/` by default, or `--dir <path>`. State lives in `<dir>/.cynap/state.json` —
never diffed, never pushed. A remote path landing under `.cynap/`, an absolute or `..` path, a
symlink anywhere on the write path, or two remote paths that collide once case-folded all make
the pull refuse before anything is written.

## The test context

Every successful pull also installs the org test context: it copies the plugin's bundle to
`<dir>/.cynap/testing.mjs` and writes the root `<dir>/package.json`, whose `imports` maps
`#cynap/testing` to it (see `/cynap-test`). The plugin owns both paths — they are rewritten on
every pull, never tracked in `state.json` and never pushed, and the platform refuses any
`package.json` in a commit. An org's own root `package.json`, if it still has one, is left out of
the sync.

## Usage

```
/cynap-pull [--dir <path>] [--take-remote <path> ...]
```

Run this **before editing**, including after another session may have changed
the accepted tip. Waiting for `parent_mismatch` can leave a stale local base
and a silently divergent edit. Pulls may take minutes without interim output;
run a long pull in the background with stdout/stderr sent to an output file,
then read that file and the exit status before editing. Invoke the CLI through
`${CLAUDE_PLUGIN_ROOT}`, not a copied versioned plugin-cache path.

In the pulled tree, `checks/` holds org suites, `operator/skills/` holds org
instructions, `operator/scripts/` holds read-only scripts, and test files or
`__tests__/` run through `/cynap-test`. The plugin's own authoring skills live
under `${CLAUDE_PLUGIN_ROOT}/skills/`. A `parent_mismatch` still means pull
again before pushing.
