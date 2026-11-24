---
description: Request owner step-up and activate an accepted Cynap workspace commit.
argument-hint: "<commit-sha> [--reconcile] [--auto] | --through <commit-sha>"
---

# /cynap-activate

Use this when `workspace_commit` or `workspace_status` returns
`next_action.kind: step_up_and_activate` or `handler_preview_required`. Run it once with that
commit digest.
`next_action.kind: reconciling` means the platform is finishing a stalled activation: do not
re-activate, discard or re-push that commit. Check `workspace_status` again later.

```sh
node "${CLAUDE_PLUGIN_ROOT}/bin/cynap-activate.mjs" $ARGUMENTS
```

Run this when the work is ready; do not ask in chat first. The owner's browser step-up is the approval, so
run it and tell the human the step-up is waiting. See the lifecycle rule in `platform-invariants`.

**Changes-page Orgs.** When `workspace_status` reports `activation_entrance: "grant"`,
the Owner approves on the Changes page instead (`changes_url`). The command prints that link and
waits up to 15 minutes for the commit to start activating, then follows it like any activation; it
never opens a step-up for such an Org. `grant_approval_pending` means the Owner has not approved yet:
tell them the link, do not re-run in a loop. `--auto` is for the platform test Org only: the
portal accepts the pending prefix as its seeded Owner persona, or refuses with
`automatic_grant_refused` and a reason. A legacy-entrance Org refuses `--auto` locally.

The local proxy opens the owner PKCE approval page, then uses the resulting
single-use purpose credential for exactly one `workspace_activate_commit` call.
Do not use device approval or call `workspace_activate_commit` directly.

The proxy runs the activation in the background and the command follows it with short reads, so
a dropped local connection does not end it: a connection error is retried up to three times within
ten seconds, then reported as `proxy_unreachable` with the socket error code. Re-running the same
command attaches to the activation already running; a different one answers
`activation_run_in_progress`. A request still waiting for the Owner is `consent_pending`, never
`failed`. The page opens only once its review is ready (`review_not_ready` if it never becomes
ready, `review_changed` if a commit changed underneath it).

The Owner has 15 minutes to approve on that page. While it waits, the org's Owners (only Owners)
get a Cynap message (in the notification bell, no email) saying an approval is waiting. The message goes away when the
approval is given, denied or expires. The proxy log says whether the Owners were notified; if it
says they were NOT notified, tell an Owner yourself.

The command reads `workspace_status` first. On `handler_preview_required`, it starts each
preview with `{orgSlug, automationId, commitSha}`, prints the running attempt or its `waiting` queue position and the attempt
id, and polls status with bounded backoff. After a pass it re-reads `workspace_status`;
only `step_up_and_activate` opens the owner approval. On fail it stops with only the verdict
code, fixed operator text, and effect kinds with counts. Never show preview row data.

A browser handler (`capabilities: ["browser"]`) activates like any other handler: only through a
passing preview. Run `/cynap-preview <automation-id> <commit-sha>`; activation needs a pass. A pass
with zero captured writes needs no further owner approval; every captured write is listed on the
owner approval page and must be approved there.

`handler_unproven` means this exact handler bundle lacks a passing proof: run
`/cynap-preview <automation-id> <commit-sha>`, then re-read status. A
`preview_unavailable` refusal means preview admission is not open. The commit
can be valid, but the strictly ordered chain cannot advance behind it until
preview is available or an authorized chain remedy is applied. Stop and report
the commit SHA; do not repeatedly activate it. A frozen chain
(`workspace_writes_frozen`) needs a platform admin today; the operator has no
unfreeze command.

A refused activation leaves that commit at the head of the pending chain, and every commit pushed
behind it answers `blocked_by_chain`. Pushing a fix on top does not help: discard the refused commit
with `/cynap-discard <commit-sha> --reason <text>`, run `/cynap-pull`, then push the fix as a new
commit. Do not discard a commit that can still pass, such as one waiting on `/cynap-preview`.

`gate_change_not_alone` means an existing check was edited or deleted in the
same commit as a runtime change. Ship the check change separately.
`checks_uncovered_path` means a changed managed path has no exact-path check
assertion in the pending suite; add coverage and make a new commit. For a deleted
path, the covering assertion needs `"allow_absent": true`.

A commit that changes `communication/webchat/<bot-slug>.json` also installs the website chat. The result lists
`webchat_installations`; once the route is active each entry carries the one-line `snippet` to hand the customer
(see the `install-website-chat` skill). `webchat_provisioning_failed` means the files are live but the install
did not finish: re-run the same activation to resume. A commit may change only one channel binding file,
`communication/webchat/*.json` or `communication/email/*.json` (`binding_change_not_single`).

## `--through <sha>`: one approval for several pending commits

When `next_action` offers `/cynap-activate --through <tip>`, run that instead of activating each
commit separately. The Owner sees the grantable prefix of the pending chain up to `<tip>` on one page,
each commit with its own review, and approves them once; they then go live in order, oldest first.
The server can end that prefix before `<tip>` at a commit it cannot grant yet. The page names the
stop, and the commits from it onward are not part of this approval: they stay pending. Compare the
result's `members` with the range you asked for, then activate the rest after the stop is resolved.

```sh
node "${CLAUDE_PLUGIN_ROOT}/bin/cynap-activate.mjs" --through <commit-sha> [--json]
```

- Handler commits in the range are previewed first, in chain order; the first non-pass stops the
  command before any approval page opens.
- After approval it prints one line per commit as it activates, and exits when the run is
  `completed`, `stopped` or `expired`. `stopped` and `expired` exit non-zero and name where it
  stopped and which commits are still pending.
- `--json` prints `{state, through, members:[{sha, position, outcome}], stopped?:{at_position, reason, remaining:[sha]}}`.
- `--through` cannot be combined with `--reconcile`.

## `--reconcile` (rare, opt-in)

Add `--reconcile` only when `next_action.kind` is `baseline_required` because the live files
carry no provenance stamp. It adopts those live files and overwrites them with the commit's
content. It still requires the owner step-up and the single-use purpose credential, exactly as
without the flag. Never use it for any other `next_action`.

```sh
node "${CLAUDE_PLUGIN_ROOT}/bin/cynap-activate.mjs" <commit-sha> --reconcile
```

## Criterion report

Read the acceptance-criterion IDs from the Request Scope view. Add optional `proves: ["c1", "c2"]`
to existing checks assertions; several assertions can map to one criterion. Keep IDs for unchanged
meanings. A changed or retired criterion needs a new ID. Unknown or unrelated IDs are inert.
Prepare platform proof before proposing. The receipt binds the exact Scope, commit, resultant
bytes and criterion-report digest; consume recomputes them before mutation. A pre-trace proposal
requires fresh preparation and Owner approval. Local reports remain diagnostics.

Describe this as an activation check the operator mapped to the criterion. Say “Check passed”;
never claim that a configuration check proves a realized business outcome. Uncovered criteria
remain prominently incomplete and do not veto activation. `allow_absent` bypasses are uncovered.
Do not put operator-authored criterion statuses into `change_overview`; Intended outcomes continue
to cite Scope outcome lines. Use the server-derived `criterion_report`.
