#!/usr/bin/env bash
# CYN-801 — operator session-trail SessionEnd hook.
#
# Behavior contract (spec §2.1/§6.4/§7):
#   - async:true, and this script EXITS 0 UNCONDITIONALLY — never blocks or
#     fails session termination, matching the precedent .claude/hooks/session-end.sh.
#   - Fires for EVERY session close, but is a NO-OP unless this project
#     directory is actually connected to the operator plane (a `.mcp.json`
#     naming the `cynap-operator` server must exist here — the ONLY dirs
#     `/cynap-connect` ever creates).
#   - Signals the STILL-RUNNING mint-proxy's local POST /session-end control
#     endpoint (derived from the same port `.mcp.json` points the MCP server
#     at) — the proxy itself decides whether to upload, based on whether its
#     own per-session marker shows this session touched the operator MCP
#     (never decided here; this script has no access to that state).
#   - The proxy's own /session-end handler is what mints the fresh token and
#     performs the upload — this hook is a thin, fail-open SIGNAL only.

set +e  # fail-open throughout — this hook must never crash or hang termination

INPUT="$(cat)"

SID="${CLAUDE_SESSION_ID:-}"
CWD=""
if command -v jq >/dev/null 2>&1; then
  CWD="$(printf '%s' "$INPUT" | jq -r '.cwd // ""' 2>/dev/null)"
  [ -z "$SID" ] && SID="$(printf '%s' "$INPUT" | jq -r '.session_id // ""' 2>/dev/null)"
else
  CWD="$(printf '%s' "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('cwd',''))" 2>/dev/null)"
  if [ -z "$SID" ]; then
    SID="$(printf '%s' "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('session_id',''))" 2>/dev/null)"
  fi
fi

[ -z "$SID" ] && exit 0
[ -z "$CWD" ] && exit 0

# Guard against injection in SID before using it in a JSON body / URL.
case "$SID" in
  ''|*[!a-zA-Z0-9_.-]*) exit 0 ;;
esac

MCP_JSON="${CWD}/.mcp.json"
[ -f "$MCP_JSON" ] || exit 0  # not a /cynap-connect directory — nothing to signal

# Read the loopback proxy's URL for the cynap-operator server and derive the
# /session-end control endpoint from it (swap the /mcp suffix).
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

[ -z "$PROXY_URL" ] && exit 0  # this dir's .mcp.json doesn't name the operator server

SESSION_END_URL="${PROXY_URL%/mcp}/session-end"

# Fire-and-forget: a short timeout so a dead/unreachable proxy never blocks
# session termination. Errors are swallowed — the proxy's own upload path is
# where real failure handling / observability lives (§7 reconciliation).
if command -v curl >/dev/null 2>&1; then
  BODY="$(printf '{"session_id":"%s"}' "$SID")"
  curl -fsS -m 5 -X POST -H 'Content-Type: application/json' -d "$BODY" "$SESSION_END_URL" >/dev/null 2>&1 || true
fi

exit 0
