---
description: Propose an accepted workspace commit on a claimed Cynap Request.
argument-hint: "<commit-sha> --request <number>"
---

# /cynap-propose

Use this when you hold a claimed build Request and your change for it is ready for the Owner.
"Ready" means two things are true:

1. A Request-bound `workspace_commit` (the call that carried `request_id`) was accepted. Its
   answer gives the 64-character commit digest.
2. Your local checks pass for that commit (`/cynap-checks`, and `/cynap-preview` for a handler).

Run it once with that commit digest and the Request's number:

```sh
node "${CLAUDE_PLUGIN_ROOT}/bin/cynap-propose.mjs" $ARGUMENTS
```

Proposing hands the commit to the Owner for review. It does not approve or activate anything.

## What it does

1. Reads the Request with `request_get`. If its state is not `claimed`, the command stops here
   and says so. Nothing is sent.
2. Asks the local proxy to prepare a proof. The server rebuilds the exact files of your commit,
   runs the org's checks on them, and returns a receipt bound to this Request, its current
   version and this commit.
3. Calls `request_operator_transition` with `verb: propose`, the commit digest and that receipt.

It prints one line on success. On a refusal it prints the server's code, then a next step, and
exits non-zero. Add `--json` for the raw result.

Do not call `workspace_prepare_commit_proof` yourself. It is not on your tool list. Preparing a
proof needs a stronger credential than your session holds, so the proxy mints one for this
single call and discards it. It is never shown to you or stored.

## Refusals you can meet

- `request_not_claimed`: the Request is in another state. Claim it first, or read it with
  `request_get` to see who holds it.
- `forbidden_actor`, `tool_not_available` or `proof_credential_refused`: your seat cannot
  prepare a proof. Today only the Owner can (or an external Operator whose grant includes
  commit and Request-claim permission). A member who is not the Owner cannot. Ask the Owner to
  run `/cynap-propose` with the same commit digest and Request number.
- `REQUEST_PROPOSAL_INTENDED_OUTCOMES_REQUIRED`: the Request has a published Scope, and your
  commit's overview does not cite it. Make a new Request-bound `workspace_commit` whose
  `change_overview.intended_outcomes` each cite at least one Scope outcome line (see the
  `summarize-your-change` skill), then propose the new commit.
- `REQUEST_ARTIFACT_UNOWNED`: a file your commit adds or changes belongs to no Solution. Add
  the listed paths to a Solution entry in `solutions.json`, commit again, then propose the new
  commit.
- `REQUEST_PREAPPROVAL_PROOF_INVALID`: the receipt no longer matches. The Request changed
  between the read and the proposal, or the receipt was made for another commit. Run the
  command again; it prepares a fresh receipt.
- `REQUEST_PREAPPROVAL_PROOF_EXPIRED`: the receipt timed out before the proposal landed. Run
  the command again.
- `proof_credential_failed`: the proxy could not mint the credential. Run `/cynap-status`; if
  your sign-in expired, run `/cynap-connect`, then run this command again.

Any other code is the server's own refusal. Report the code and the Request number; do not
retry in a loop.
