#!/usr/bin/env bash
# Operator-plane SessionStart org-orientation banner.
#
# Why this exists: a session opened inside a `/cynap-connect` working dir had
# NO indication it was pinned to an operator org — the MCP tools are just
# there or not, silently, with zero context about which org, whether the proxy
# is actually alive, or how long the underlying credential has left. This hook
# closes that: on every session start, if the cwd is a connected working dir,
# it emits ONE line of additionalContext identifying the org + proxy health +
# credential expiry, so the FIRST thing a session "sees" is "you are attached
# to <org>", not silence.
#
# Behavior contract:
#   - SYNCHRONOUS (async:false) and registered FIRST in hooks.json, so its
#     additionalContext lands before anything else this session start emits.
#   - Bounded to ~3s total — the `curl -m 3` health probe is the one slow step.
#   - EXITS 0 UNCONDITIONALLY — never blocks or fails session start, mirrors
#     session-start.sh's fail-open contract.
#   - NO-OP (prints nothing) unless this project dir is a /cynap-connect
#     working dir (a `.mcp.json` naming the `cynap-operator` server) — it fires
#     for every session, so the cwd gate is what keeps it silent everywhere else.
#   - Reads ONLY what /health already exposes (org, env, version,
#     credExpiresInHours) — carries no token/cookie/credential, mirroring
#     /health's own "no secrets" contract.
#   - Does NOT relaunch a dead proxy — that is session-start.sh's job (kept as
#     a separate, async hook registered second). This hook only REPORTS.

set +e # fail-open throughout — must never crash or hang session start

INPUT="$(cat)"

CWD=""
if command -v jq >/dev/null 2>&1; then
  CWD="$(printf '%s' "$INPUT" | jq -r '.cwd // ""' 2>/dev/null)"
else
  CWD="$(printf '%s' "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('cwd',''))" 2>/dev/null)"
fi

[ -z "$CWD" ] && exit 0
# Everything below (reading .mcp.json fields, reading /health fields, building
# the additionalContext JSON) goes through jq — no-op without it.
command -v jq >/dev/null 2>&1 || exit 0

MCP_JSON="${CWD}/.mcp.json"
[ -f "$MCP_JSON" ] || exit 0 # not a /cynap-connect directory — nothing to report

PROXY_URL="$(jq -r '.mcpServers["cynap-operator"].url // ""' "$MCP_JSON" 2>/dev/null)"
[ -z "$PROXY_URL" ] && exit 0 # this dir's .mcp.json doesn't name the operator server

HEALTH_URL="${PROXY_URL%/mcp}/health"

command -v curl >/dev/null 2>&1 || exit 0

HEALTH_JSON="$(curl -fsS -m 3 "$HEALTH_URL" 2>/dev/null)"

if [ -z "$HEALTH_JSON" ]; then
  BODY="Cynap operator plane: this session's working directory is pinned to an operator org, but its proxy is NOT responding at ${HEALTH_URL}. Tools from the \`cynap-operator\` MCP server will fail until it recovers — the SessionStart relaunch hook will try to bring it back automatically, or run \`/cynap-status\` to check, or \`/cynap-connect\` to reconnect."
else
  ORG="$(printf '%s' "$HEALTH_JSON" | jq -r '.org // "unknown"' 2>/dev/null)"
  ENV="$(printf '%s' "$HEALTH_JSON" | jq -r '.env // "unknown"' 2>/dev/null)"
  VERSION="$(printf '%s' "$HEALTH_JSON" | jq -r '.version // "unknown"' 2>/dev/null)"
  EXP_HOURS="$(printf '%s' "$HEALTH_JSON" | jq -r '.credExpiresInHours // empty' 2>/dev/null)"

  EXP_NOTE=""
  if [ -n "$EXP_HOURS" ]; then
    if [ "$EXP_HOURS" -lt 6 ] 2>/dev/null; then
      EXP_NOTE=" ⚠️ operator credential expires in ~${EXP_HOURS}h — re-run \`/cynap-connect\` soon."
    else
      EXP_NOTE=" (credential expires in ~${EXP_HOURS}h)"
    fi
  fi

  BODY="Cynap operator plane: this session is ATTACHED to org \`${ORG}\` (${ENV}, proxy v${VERSION}).${EXP_NOTE} MCP tools from \`cynap-operator\` are live. Run \`/cynap-status\` for the full fleet view."
fi

jq -nc --arg ctx "$BODY" \
  '{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:$ctx}}' 2>/dev/null

exit 0
