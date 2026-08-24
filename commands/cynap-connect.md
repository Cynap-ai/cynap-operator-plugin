---
description: Materialize a per-org working directory connected to the Cynap operator MCP endpoint.
argument-hint: "<org-slug>"
---

# /cynap-connect

Materializes a dedicated per-org working directory
(`~/CynapOperator/<org-slug>/`) connected to the Cynap operator plane: one
directory = one org = one proxy port, self-contained and independent of
wherever you happened to invoke this command from. Re-running this command
for a different org slug creates another such directory, so you can run
multiple orgs side by side, each on its own loopback port — never share one
proxy across two org dirs.

## Arguments

```
/cynap-connect <org-slug> [--staging]
```

**Production is the default.** Real operator work happens against real customer
orgs, which live on prod (`cynap.ai` / `api.cynap.ai`) — so the common case must
not require a flag. `--staging` opts INTO the staging plane and is the exception;
pass `env: 'staging'` to `planConnect`, which reaches the proxy as `--staging`.

Defaulting to staging was the original shape and it was wrong twice over: it made
the normal case the flagged one, and it silently pointed operators at an
environment that can be arbitrarily stale (staging once sat 201 commits behind
main, missing the operator consent page entirely — so a connect there "worked"
while authoring against a fake world). An accidental prod connect is an
authenticated read-mostly session on an org you already hold a grant on; an
accidental staging connect is work done against the wrong reality.

Because the headless `--e2e` cookie leg is staging-only, `/cynap-connect cynap-e2e`
with no flag now takes the PKCE consent path. Use `--staging` for the headless
dogfood flow.

**Any org the operator holds a grant on is connectable**, not just `cynap-e2e`.
For the interactive (PKCE) and device legs the client does NOT need to know the
org id: the login returns the org inside the issued credential (the server
resolves it from the operator's own grant and freezes it into the token), and
the proxy pins itself to that after login. So `planConnect` returns
`orgId: null` for such orgs and `buildProxyArgv` omits `--allow-org` — that is
the correct shape, not a missing value. Only the headless `--e2e` cookie leg
still needs an offline org-id mapping, because it has no consent step to resolve
one; it remains `cynap-e2e`-only.

If a login yields no org AND no `--allow-org` was pinned, the proxy **refuses to
start** rather than fall back to its built-in default org — otherwise a connect
meant for one tenant could silently serve another.

## v1 scope (read this before running)

- **Login is mode-keyed (CYN-901), never a shared secret.** The bundled proxy
  (`${CLAUDE_PLUGIN_ROOT}/bin/operator-proxy.mjs`) authenticates via
  **PKCE-loopback by default** (opens a browser; yields a CLI-scoped `octk_…`
  credential — mints operator tokens for ONE org only, absolute ≤48h, revoked
  on exit), `--device` (RFC 8628) for headless machines, or `--e2e` — the
  staging-only headless `e2e-session` cookie leg, hardcoded to `cynap-e2e`
  (`resolveAuthMode` in `lib/connect.mjs` picks `--e2e` for cynap-e2e on
  staging, PKCE otherwise). The old `CYNAP_OPERATOR_COOKIE` manual-cookie
  stopgap is **deleted** — the proxy no longer reads it; do not set it.
- **`cynap-e2e` is the only org this plugin can resolve OFFLINE.** The
  slug→org-id map used for the client-side `--allow-org` pin ships only the
  cynap-e2e entry; the authoritative org resolution for a PKCE/device login is
  server-side (the credential is frozen to the org the consent screen
  approved, and the proxy pins itself to it).
- **Server-side org enforcement is the authoritative boundary**, not this
  command's client-side `--allow-org` pin. [internal reference omitted from public mirror]
  re-resolves org access against your better-auth session on every mint and
  freezes the DB-returned `orgId` into the token — a client asking for an org
  it has no grant for gets a `403 no_grant` regardless of what this plugin
  does locally. **Honesty note (P0 acceptance scope):** this plugin ships only
  the CLIENT-side regression guard for that pin (`__tests__/org-pin-refusal.test.mjs`
  asserts the packaged proxy's `createTokenManager` throws on a targetOrgId
  mismatch). The server-side `403 no_grant` denial is real and already live
  (it's the already-shipped mint route), but it is not independently
  demonstrated by this PR — live-proving it end to end is part of the P6 bake.
- **No plugin-root MCP server ships.** This plugin does NOT declare an
  `.mcp.json` at its root. Claude Code dedupes plugin-provided MCP servers by
  **endpoint**, not by name — so a fixed-port plugin-root server would
  coexist with (never be overridden by) the per-dir ephemeral-port server
  this command generates, producing a permanently-failed auto-connect on
  plugin enable. The ONLY MCP server this plugin ever provisions is the
  per-dir project `.mcp.json` this command writes into
  `~/CynapOperator/<slug>/`.

## What this command does

1. **Parse `$ARGUMENTS` into a slug and an environment** — it is NOT a single
   argument. Take the first whitespace-separated token as the org slug, and
   treat a `--staging` token anywhere in the rest as `env: 'staging'`;
   otherwise `env: 'prod'` (the default). Do NOT pass the raw argument string
   as the slug: `"cynap-e2e --staging"` is not an org, and `planConnect` will
   reject it as an invalid slug. Reject any other unrecognized token rather
   than silently folding it into the slug.
   `resolveAuthMode(slug, env)` then picks the login mode (cynap-e2e on
   staging → headless `--e2e`; everything else → interactive PKCE, which opens
   a browser consent screen — tell the operator to expect it).
**Run `planConnect()` and do what its `action` says — do not hand-roll these
steps.** `planConnect({ slug, env, proxyPath: '${CLAUDE_PLUGIN_ROOT}/bin/operator-proxy.mjs' })`
returns `{ port, workingDir, mcpJsonPath, launchRecordPath, action, actionReason,
health, launchCommand, … }` and has already written `.mcp.json` +
`proxy-launch.json` by the time it returns.

2. The port is **stable per org** (`stablePortForSlug(slug)` — a slug-derived
   port in 39000-39999), NOT ephemeral. This is deliberate: an ephemeral port
   per connect meant `.mcp.json` and the running proxy drifted apart the moment
   either restarted, and every re-connect orphaned the previous proxy. With a
   stable port, `.mcp.json` is a pure function of the org and re-connecting is
   idempotent.
3. The per-org working directory is `~/CynapOperator/<slug>/`, holding
   `.mcp.json` (points at `http://127.0.0.1:<port>/mcp`; **no secret**),
   `proxy-launch.json` (how to relaunch; no secret), and `proxy.log`.
   `~/CynapOperator/<slug>` is visible in Finder and the Claude Desktop
   folder-picker — the operator can open a Claude Code session there directly.
   Tell the operator the absolute path; don't let them conclude nothing happened.
4. Act on `action`:
   - **`reuse`** — a healthy proxy for this org is already listening. Say so and
     launch NOTHING. (Re-running `/cynap-connect` must never spawn a twin.)
   - **`launch`** — run the returned `launchCommand` **verbatim**. It is
     `nohup node … & … disown`, which is load-bearing: the proxy MUST outlive
     this session, because the session that uses the connection is a *different*
     one (step 6). A bare `node …` here is the bug that made connect look broken
     — the proxy died at the handoff and left `.mcp.json` pointing at a dead port.
   - **`conflict`** — the stable port is serving a DIFFERENT org. Refuse and
     report `actionReason`; never proxy an operator at the wrong tenant.
   In interactive (PKCE) mode the proxy opens a browser for the operator's
   consent BEFORE it starts serving — it exits with `operator login failed`
   if the login is denied or times out.
5. Verify before handing off: poll `GET http://127.0.0.1:<port>/health` until it
   returns `{ok:true}` with the expected `org` (a second or two). Report the
   real result — a launch that silently failed must not be reported as connected.
6. Tell the operator to `cd ~/CynapOperator/<slug>` and run `/reload-plugins`
   there (or open a new session in that dir) so Claude Code picks up that
   directory's `.mcp.json`. **The session that ran `/cynap-connect` cannot use
   the connection** — its cwd is elsewhere, so `.mcp.json` does not apply to it,
   and `workspace_*` tools will not exist in it. Say this plainly rather than
   appearing to half-succeed. If that session later finds the proxy dead, the
   bundled SessionStart hook relaunches it automatically from
   `proxy-launch.json`.

## Usage

```
/cynap-connect cynap-e2e
```

## Staging behind Vercel SSO — the protection-bypass secret (CYN-768)

`staging.cynap.ai` (the portal the proxy mints against) is behind **Vercel
Deployment Protection (SSO)**, so both the proxy's `e2e-session` cookie call and
its `operator-token` mint call get a `401 "Protected deployment"` at the SSO wall
unless the request carries a **"Protection Bypass for Automation"** secret. Set it
in the proxy's environment before `/cynap-connect`:

```
export CYNAP_STAGING_PROTECTION_BYPASS=<the-vercel-automation-bypass-secret>
```

(the proxy also honors Vercel's canonical `VERCEL_AUTOMATION_BYPASS_SECRET` and the
repo-documented `VERCEL_BYPASS_TOKEN`). The secret lives in the Vercel project →
Settings → Deployment Protection → *Protection Bypass for Automation*. It is scoped
to the two portal calls only — the operator JWT the proxy injects is JWKS-verified
by the backend (no portal round-trip), so the MCP path never needs it. Prod does not
need this (the `e2e-session` route is HARD-OFF on prod).

## After connecting

Verify the connection with a read-only operator tool call (e.g.
`workspace_status`). If it 401s, the proxy failed to mint — check its stderr
log for `[operator-proxy] fatal:`. A `Protected deployment` / `vercel_auth` 401 in
that log means the staging SSO bypass secret above is missing or wrong; a plain
`403 no_grant` means you have no membership/active grant for the org you
connected to (or the credential's bound org doesn't match).
