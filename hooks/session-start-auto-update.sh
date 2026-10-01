#!/usr/bin/env bash
# Operator-plane SessionStart automatic plugin update.
#
# Releases that do not raise the server minimum never trigger the proxy's
# `plugin_outdated` self-update, so this hook installs them at session start.
# It only launches the work: the node helper in bin/operator-proxy.mjs
# (runProactivePluginUpdate) owns the throttle (6h), the one-flight lock, the
# install and its verification, and logs to the working dir's proxy.log.
#
# Behavior contract (mirrors session-start.sh):
#   - async:true and EXITS 0 UNCONDITIONALLY — never blocks or fails session start.
#   - NO-OP unless this project dir is a /cynap-connect working dir (a `.mcp.json`
#     naming the `cynap-operator` server).
#   - The update runs DETACHED with its own 5-minute kill timer, so it outlives
#     this hook's 10s budget.

set +e # fail-open throughout

INPUT="$(cat)"

CWD=""
if command -v jq >/dev/null 2>&1; then
  CWD="$(printf '%s' "$INPUT" | jq -r '.cwd // ""' 2>/dev/null)"
else
  CWD="$(printf '%s' "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('cwd',''))" 2>/dev/null)"
fi
[ -z "$CWD" ] && exit 0
[ -f "${CWD}/.mcp.json" ] || exit 0
grep -q 'cynap-operator' "${CWD}/.mcp.json" 2>/dev/null || exit 0
[ -n "$CLAUDE_PLUGIN_ROOT" ] || exit 0
command -v node >/dev/null 2>&1 || exit 0
command -v claude >/dev/null 2>&1 || exit 0

CYNAP_WORKDIR="$CWD" nohup node --input-type=module -e '
const timer = setTimeout(() => process.exit(0), 300000);
timer.unref();
try {
  const { runProactivePluginUpdate } = await import(`${process.env.CLAUDE_PLUGIN_ROOT}/bin/operator-proxy.mjs`);
  await runProactivePluginUpdate({ cwd: process.env.CYNAP_WORKDIR });
} catch {
  // fail-open: an update problem must never surface as a session problem
}
process.exit(0);
' >>"${CWD}/proxy.log" 2>&1 &

exit 0
