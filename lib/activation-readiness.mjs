// readiness of a commit, read only from the server's projected marker. An older server
// sends no `readiness` field (degrade, never mislabel), and a record for another commit
// says nothing about this one: both read as unknown.
const READINESS_STATES = new Set(['yes', 'projecting', 'failed']);

export function readinessOf(status, commitSha) {
  const readiness = status?.readiness;
  if (!readiness || readiness.commit_sha !== commitSha || !READINESS_STATES.has(readiness.state)) return 'unknown';
  return readiness.state;
}

/** The readiness line shared by /cynap-activate and /cynap-status. */
export function describeReady(ready) {
  return ready === 'yes' ? 'ready: yes'
    : ready === 'projecting' ? 'ready: projecting (the analytics projection is still running; /cynap-status shows when it lands)'
    : ready === 'failed' ? 'ready: failed (the analytics projection failed; /cynap-status shows the commit)'
    : 'ready: unknown';
}
