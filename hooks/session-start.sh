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

# The recorded command names the plugin root /cynap-connect ran from. Claude Code
# caches every plugin version in its OWN directory, so after an update that root
# is the PREDECESSOR build — replaying it verbatim revives the old proxy (the
# 2026-09-22 0.17.5 -> 0.17.3 restart). $CLAUDE_PLUGIN_ROOT is this session's
# actual root, so rebase the record onto it and persist the result.
#
# A rebase that cannot be done safely is a REFUSAL, not a fallback: reviving a
# stale build is the defect. Exiting 0 leaves the proxy dead, which the next
# operator command's consent/self-update path handles.
if [ -n "$CLAUDE_PLUGIN_ROOT" ] && command -v node >/dev/null 2>&1; then
  REBASED_CMD="$(CYNAP_LAUNCH_FILE="$LAUNCH_FILE" CYNAP_WORKDIR="$CWD" node --input-type=module -e '
import { readFileSync } from "node:fs";
const { rebaseLaunchRecord, writeLaunchRecordFile } = await import(
  `${process.env.CLAUDE_PLUGIN_ROOT}/bin/operator-proxy.mjs`
);
const record = JSON.parse(readFileSync(process.env.CYNAP_LAUNCH_FILE, "utf8"));
const successor = rebaseLaunchRecord(record, process.env.CLAUDE_PLUGIN_ROOT);
if (!successor) process.exit(1);
if (successor !== record) writeLaunchRecordFile({ launchRecord: successor, cwd: process.env.CYNAP_WORKDIR });
process.stdout.write(successor.launchCommand);
' 2>/dev/null)"
  # shellcheck disable=SC2181 # the rc belongs to the command substitution above
  if [ $? -ne 0 ] || [ -z "$REBASED_CMD" ]; then
    exit 0 # cannot name the current build — never revive a stale one
  fi
  LAUNCH_CMD="$REBASED_CMD"
fi

# Detached relaunch, output appended to the working dir's proxy.log.
(
  cd "$CWD" 2>/dev/null || exit 0
  eval "$LAUNCH_CMD"
) >/dev/null 2>&1

exit 0
