#!/usr/bin/env bash
# Operator-plane SessionStart self-heal hook.
#
# Why this exists: `/cynap-connect` necessarily runs in a DIFFERENT session from
# the one that uses the connection (connect writes ~/CynapOperator/<org>/, then
# you open a session there). The proxy is therefore always started by a session
# that is not the consumer, and before the detached-launch fix it died at exactly
# that handoff — leaving a valid-looking `.mcp.json` pointing at a dead port, and
# an operator staring at a connection that "just doesn't work". Detaching the
# proxy fixes the common case; this hook closes the rest: reboots, OOM kills,
# manual `kill`, or simply not having connected in days.
#
# Behavior contract (mirrors session-end.sh):
#   - async:true and EXITS 0 UNCONDITIONALLY — never blocks or fails session start.
#   - NO-OP unless this project dir is a /cynap-connect working dir (a `.mcp.json`
#     naming the `cynap-operator` server). It fires for every session, so the
#     cwd gate is what keeps it inert everywhere else.
#   - NO-OP when a healthy proxy is already listening (the common case) — the
#     /health probe is the whole decision; this script holds no state.
#   - Only ever relaunches the proxy the working dir is ALREADY pinned to. It
#     never picks an org, never changes a port, never mints anything.

set +e # fail-open throughout — must never crash or hang session start

INPUT="$(cat)"

CWD=""
if command -v jq >/dev/null 2>&1; then
  CWD="$(printf '%s' "$INPUT" | jq -r '.cwd // ""' 2>/dev/null)"
else
  CWD="$(printf '%s' "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('cwd',''))" 2>/dev/null)"
fi

[ -z "$CWD" ] && exit 0

MCP_JSON="${CWD}/.mcp.json"
[ -f "$MCP_JSON" ] || exit 0 # not a /cynap-connect directory — nothing to heal

PROXY_URL=""
if command -v jq >/dev/null 2>&1; then
  PROXY_URL="$(jq -r '.mcpServers["cynap-operator"].url // ""' "$MCP_JSON" 2>/dev/null)"
else
  PROXY_URL="$(python3 -c "
import json, sys
try:
    with open(sys.argv[1]) as f:
        d = json.load(f)
    print(d.get('mcpServers', {}).get('cynap-operator', {}).get('url', ''))
except Exception:
    print('')
" "$MCP_JSON" 2>/dev/null)"
fi

[ -z "$PROXY_URL" ] && exit 0 # this dir's .mcp.json doesn't name the operator server

HEALTH_URL="${PROXY_URL%/mcp}/health"

command -v curl >/dev/null 2>&1 || exit 0

# Already healthy? Then there is nothing to do — this is the hot path.
if curl -fsS -m 3 "$HEALTH_URL" >/dev/null 2>&1; then
  exit 0
fi

# Dead. Relaunch the proxy this working dir is pinned to, using the argv recorded
# at connect time. Without that record we deliberately do NOTHING rather than
# guess an org/auth-mode — a wrong guess here would mint against the wrong tenant.
LAUNCH_FILE="${CWD}/proxy-launch.json"
[ -f "$LAUNCH_FILE" ] || exit 0

LAUNCH_CMD=""
if command -v jq >/dev/null 2>&1; then
  LAUNCH_CMD="$(jq -r '.launchCommand // ""' "$LAUNCH_FILE" 2>/dev/null)"
else
  LAUNCH_CMD="$(python3 -c "
import json, sys
try:
    with open(sys.argv[1]) as f:
        print(json.load(f).get('launchCommand', ''))
except Exception:
    print('')
" "$LAUNCH_FILE" 2>/dev/null)"
fi

[ -z "$LAUNCH_CMD" ] && exit 0

# Detached relaunch, output appended to the working dir's proxy.log.
(
  cd "$CWD" 2>/dev/null || exit 0
  eval "$LAUNCH_CMD"
) >/dev/null 2>&1

exit 0
