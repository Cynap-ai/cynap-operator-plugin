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

## Usage

```
/cynap-pull [--dir <path>] [--take-remote <path> ...]
```

Run this before `/cynap-push` whenever `workspace_commit` answers `parent_mismatch` — the
accepted tip moved since your last pull.
