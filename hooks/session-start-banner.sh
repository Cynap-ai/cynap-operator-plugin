#!/usr/bin/env bash
# Operator-plane SessionStart org-orientation banner.
#
# Why this exists: a session opened inside a `/cynap-connect` working dir had
# NO indication it was pinned to an operator org — the MCP tools are just
# there or not, silently, with zero context about which org, whether the proxy
# is actually alive, how long the underlying credential has left, or what the
# org actually looks like. This hook closes that: on every session start, if
# the cwd is a connected working dir, it prints plain text identifying the
# org + proxy health + credential expiry, then — ONLY when everything above
# succeeded — the org brief the proxy fetches from the backend over its local
# GET /context endpoint. Any single failure anywhere in that chain (dead
# proxy, expired/missing nonce, an old proxy with no /context route, a
# backend refusal) collapses the WHOLE output to one terse fallback line,
# rather than a half-populated banner.
#
# Readiness: on 2026-09-23 a session opened while its proxy was
# not up yet, and the banner gave up at once with `proxy_not_responding` —
# the session started with no org facts at all. The banner now WAITS, within
# a bounded budget, for a proxy that is expected to come up: one that answered
# /health but is not ready yet, or one that is not listening while this dir
# holds the launch record session-start.sh relaunches it from. It then
# retries a /context that answered 504 (the proxy's first brief fetch is
# still running); each retry joins that same single-flight fetch.
#
# Behavior contract:
#   - SYNCHRONOUS (async:false) and registered FIRST in hooks.json, so its
#     output lands before anything else this session start emits.
#   - PLAIN STDOUT (not hookSpecificOutput JSON) — Codex 0.154.0 does not
#     understand the hookSpecificOutput envelope for this hook (openai/codex
#     #45999), so both harnesses get the same plain-text contract.
#   - Bounded to BRIEF_DEADLINE_S (12s) total, under the 15s hook budget:
#     /health is polled for at most READY_WAIT_S (6s), and only when readiness
#     is expected — a dir with no launch record and nothing listening fails
#     at once. Every curl carries its own hard timeout.
#   - EXITS 0 UNCONDITIONALLY — never blocks or fails session start.
#   - NO-OP (prints nothing) unless this project dir is a /cynap-connect
#     working dir (a `.mcp.json` naming the `cynap-operator` server) — it
#     fires for every SessionStart source, so the cwd gate is what keeps it
#     silent everywhere else.
#   - Reads ONLY what /health and /context already expose — carries no
#     token/cookie/credential itself; the nonce it sends to /context is read
#     from the proxy's own `.operator-control` file (0600, written by the
#     proxy at launch), never generated or cached here.
#   - Total output (health line + freshness line + brief) is capped at 9,800
#     bytes, and a cut is EXPLICIT: the last line says the brief was truncated
#     and names the full resource. The freshness line states the brief's age
#     from the proxy's X-Cynap-Brief-* headers and says STALE past 15 minutes.
#   - Does NOT relaunch a dead proxy — that is session-start.sh's job (kept
#     as a separate, async hook registered second). This hook only REPORTS.

set +e # fail-open throughout — must never crash or hang session start

MAX_OUTPUT_BYTES=9800
READY_WAIT_S=6
BRIEF_DEADLINE_S=12
# The proxy refreshes its in-memory brief every 10 min (and after an
# activation or re-auth); a brief older than this has missed at least one.
STALE_AFTER_MS=900000

# Emits the one-line fallback for ANY failure past the connect-dir gate.
# `ctx_uri` (the backend resource pointer) is only ever available once
# /health has answered — omitted otherwise, never a placeholder.
emit_unavailable() {
  reason="$1"
  ctx_uri="$2"
  if [ -n "$ctx_uri" ] && [ "$ctx_uri" != "null" ]; then
    echo "Org brief unavailable (${reason}). Read ${ctx_uri}."
  else
    echo "Org brief unavailable (${reason})."
  fi
}

main() {
  INPUT="$(cat)"

  CWD=""
  if command -v jq >/dev/null 2>&1; then
    CWD="$(printf '%s' "$INPUT" | jq -r '.cwd // ""' 2>/dev/null)"
  else
    CWD="$(printf '%s' "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('cwd',''))" 2>/dev/null)"
  fi
  [ -z "$CWD" ] && return 0

  MCP_JSON="${CWD}/.mcp.json"
  [ -f "$MCP_JSON" ] || return 0 # not a /cynap-connect directory — nothing to report

  # Cheap, jq-free gate: confirms this dir names the operator server before
  # anything below decides whether jq itself is even available.
  grep -q 'cynap-operator' "$MCP_JSON" 2>/dev/null || return 0

  if ! command -v jq >/dev/null 2>&1; then
    echo "Org brief unavailable (jq_missing)."
    return 0
  fi
  command -v curl >/dev/null 2>&1 || return 0

  PROXY_URL="$(jq -r '.mcpServers["cynap-operator"].url // ""' "$MCP_JSON" 2>/dev/null)"
  [ -z "$PROXY_URL" ] && return 0 # this dir's .mcp.json doesn't name the operator server

  BASE_URL="${PROXY_URL%/mcp}"
  HEALTH_URL="${BASE_URL}/health"
  CONTEXT_URL="${BASE_URL}/context"
  CONTROL_FILE="${CWD}/.operator-control"

  LAUNCH_FILE="${CWD}/proxy-launch.json"
  SECONDS=0
  while :; do
    HEALTH_JSON="$(curl -sS -m 1 "$HEALTH_URL" 2>/dev/null)"
    HEALTH_OK="$(printf '%s' "$HEALTH_JSON" | jq -r '.ok // false' 2>/dev/null)"
    [ "$HEALTH_OK" = "true" ] && break
    # Wait only when readiness is expected: the proxy answered but is still
    # starting, or nothing answered and session-start.sh has a launch record.
    if [ -z "$HEALTH_JSON" ] && [ ! -f "$LAUNCH_FILE" ]; then
      break
    fi
    [ "$SECONDS" -ge "$READY_WAIT_S" ] && break
    sleep 0.5
  done
  CTX_URI="$(printf '%s' "$HEALTH_JSON" | jq -r '.contextUri // empty' 2>/dev/null)"

  if [ "$HEALTH_OK" != "true" ]; then
    PROXY_STATUS="$(printf '%s' "$HEALTH_JSON" | jq -r '.status // empty' 2>/dev/null)"
    if [ -n "$PROXY_STATUS" ]; then
      emit_unavailable "proxy_not_ready: ${PROXY_STATUS} after ${SECONDS}s" "$CTX_URI"
    elif [ "$SECONDS" -gt 0 ]; then
      emit_unavailable "proxy_not_responding after ${SECONDS}s" "$CTX_URI"
    else
      emit_unavailable "proxy_not_responding" "$CTX_URI"
    fi
    return 0
  fi

  if [ ! -f "$CONTROL_FILE" ]; then
    emit_unavailable "no_control_file" "$CTX_URI"
    return 0
  fi
  NONCE="$(tr -d '[:space:]' <"$CONTROL_FILE" 2>/dev/null)"
  if [ -z "$NONCE" ]; then
    emit_unavailable "no_control_file" "$CTX_URI"
    return 0
  fi

  # -i puts the response headers (the brief's freshness) ahead of the body.
  # Each request gets 4s: the proxy itself answers 504 after waiting 3.5s.
  while :; do
    BRIEF_RAW="$(curl -sS -i -m 4 -H "x-cynap-operator-control: ${NONCE}" -w '\nHTTPSTATUS:%{http_code}' "$CONTEXT_URL" 2>/dev/null)"
    CURL_RC=$?
    HTTP_CODE="$(printf '%s' "$BRIEF_RAW" | sed -n 's/.*HTTPSTATUS://p')"
    # 504 = the proxy's first brief fetch is still running; the next request
    # joins that same fetch, so retry while a whole request still fits the budget.
    if [ "$CURL_RC" -eq 0 ] && [ "$HTTP_CODE" = "504" ] && [ $((BRIEF_DEADLINE_S - SECONDS)) -ge 4 ]; then
      continue
    fi
    break
  done
  if [ "$CURL_RC" -ne 0 ]; then
    emit_unavailable "context_unreachable" "$CTX_URI"
    return 0
  fi

  BRIEF_HEADERS="${BRIEF_RAW%%$'\r\n\r\n'*}"
  BRIEF_RAW="${BRIEF_RAW#*$'\r\n\r\n'}"
  BRIEF_AGE_MS="$(printf '%s\n' "$BRIEF_HEADERS" | tr -d '\r' | sed -n 's/^[Xx]-[Cc]ynap-[Bb]rief-[Aa]ge-[Mm]s: *//p' | head -1)"
  BRIEF_FETCHED_AT="$(printf '%s\n' "$BRIEF_HEADERS" | tr -d '\r' | sed -n 's/^[Xx]-[Cc]ynap-[Bb]rief-[Ff]etched-[Aa]t: *//p' | head -1)"
  BRIEF_TEXT="${BRIEF_RAW%HTTPSTATUS:*}"
  BRIEF_TEXT="${BRIEF_TEXT%$'\n'}"

  if [ "$HTTP_CODE" = "404" ]; then
    # An older proxy build with no /context route at all — not a real failure,
    # just a stale install; word it that way rather than a generic error.
    emit_unavailable "proxy_too_old" "$CTX_URI"
    return 0
  fi
  if [ "$HTTP_CODE" != "200" ]; then
    REASON="$(printf '%s' "$BRIEF_TEXT" | jq -r '.reason // empty' 2>/dev/null)"
    [ -z "$REASON" ] && REASON="upstream_error"
    emit_unavailable "$REASON" "$CTX_URI"
    return 0
  fi

  ORG="$(printf '%s' "$HEALTH_JSON" | jq -r '.org // "unknown"' 2>/dev/null)"
  ENV="$(printf '%s' "$HEALTH_JSON" | jq -r '.env // "unknown"' 2>/dev/null)"
  # .pluginVersion is the live field name; .version is a defensive fallback
  # for a proxy build old enough to still be using the retired key.
  VERSION="$(printf '%s' "$HEALTH_JSON" | jq -r '.pluginVersion // .version // "unknown"' 2>/dev/null)"
  EXP_HOURS="$(printf '%s' "$HEALTH_JSON" | jq -r '.credExpiresInHours // empty' 2>/dev/null)"

  CRED_EXPIRED=0
  EXP_NOTE=""
  if [ -n "$EXP_HOURS" ]; then
    if [ "$EXP_HOURS" -le 0 ] 2>/dev/null; then
      CRED_EXPIRED=1
    elif [ "$EXP_HOURS" -lt 6 ] 2>/dev/null; then
      EXP_NOTE=" ⚠️ operator credential expires in ~${EXP_HOURS}h — the next operator command will reopen browser consent by itself; \`/cynap-connect\` is optional."
    else
      EXP_NOTE=" (credential expires in ~${EXP_HOURS}h)"
    fi
  fi

  # NEVER say the connection is live once the credential has actually
  # expired (credExpiresInHours <= 0) — the proxy process is still up and
  # still answering /health and /context, but the credential behind it is not
  # usable until consent is re-granted. The proxy now reopens that consent by
  # itself on the next credential-bearing call, so the line says what WILL
  # happen rather than sending the operator off to re-run a command.
  if [ "$CRED_EXPIRED" = "1" ]; then
    HEALTH_LINE="Cynap operator plane: this session's working directory is pinned to org \`${ORG}\` (${ENV}, proxy v${VERSION}), but its operator credential has EXPIRED. The next operator command or tool call reopens browser consent automatically and then continues — approve it in the browser. \`/cynap-connect\` still works if you would rather reconnect explicitly."
  else
    HEALTH_LINE="Cynap operator plane: this session is ATTACHED to org \`${ORG}\` (${ENV}, proxy v${VERSION}).${EXP_NOTE} MCP tools from \`cynap-operator\` are live. Run \`/cynap-status\` for the full fleet view."
  fi

  if [ -n "$BRIEF_AGE_MS" ] && [ "$BRIEF_AGE_MS" -ge 0 ] 2>/dev/null; then
    AGE_S=$((BRIEF_AGE_MS / 1000))
    if [ "$BRIEF_AGE_MS" -gt "$STALE_AFTER_MS" ]; then
      FRESHNESS_LINE="STALE org brief: fetched ${BRIEF_FETCHED_AT} (${AGE_S}s ago), past the proxy's 10-minute refresh. Re-read ${CTX_URI} before relying on it."
    else
      FRESHNESS_LINE="Org brief fetched ${BRIEF_FETCHED_AT} (${AGE_S}s ago)."
    fi
  else
    FRESHNESS_LINE="Org brief age unknown (this proxy build sends no freshness headers)."
  fi

  PREFIX="${HEALTH_LINE}"$'\n'"${FRESHNESS_LINE}"$'\n\n'
  PREFIX_BYTES="$(printf '%s' "$PREFIX" | wc -c | tr -d ' ')"
  BRIEF_BYTES="$(printf '%s\n' "$BRIEF_TEXT" | wc -c | tr -d ' ')"
  if [ $((PREFIX_BYTES + BRIEF_BYTES)) -gt "$MAX_OUTPUT_BYTES" ]; then
    # ASCII only, so its character count is its byte count.
    MARKER="[org brief truncated: the banner shows ${MAX_OUTPUT_BYTES} bytes, the brief is ${BRIEF_BYTES}. Read ${CTX_URI} for the rest.]"
    KEEP=$((MAX_OUTPUT_BYTES - PREFIX_BYTES - ${#MARKER} - 2))
    printf '%s' "$PREFIX"
    printf '%s' "$BRIEF_TEXT" | head -c "$KEEP"
    printf '\n%s\n' "$MARKER"
  else
    printf '%s%s\n' "$PREFIX" "$BRIEF_TEXT"
  fi
}

# `head -c` is only a backstop — main() already fits its output and marks any cut.
OUTPUT="$(main)"
[ -n "$OUTPUT" ] && printf '%s\n' "$OUTPUT" | head -c "$MAX_OUTPUT_BYTES"

exit 0
