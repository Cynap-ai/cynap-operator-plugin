export function partialMatch(expected, actual) {
  if (expected === null || typeof expected !== 'object') return Object.is(expected, actual);
  if (actual === null || typeof actual !== 'object') return false;
  return Object.entries(expected).every(([key, value]) => Object.hasOwn(actual, key) && partialMatch(value, actual[key]));
}
const result = (data) => ({ content: [], structuredContent: data });
const failure = (code, message) => ({ isError: true, content: [{ type: 'text', text: message }], structuredContent: { code, message } });
export function createFixtureBroker({ entries, viewer, isWrite, admission, onMissing = () => {}, onCall = () => {}, onWrite = () => {} }) {
  const writes = new Map();
  let count = 0;
  const call = async ({ tool, arguments: args }) => {
    if (tool === 'query_metrics' && Array.isArray(args.reads)) {
      const results = await Promise.all(args.reads.map(async (read) => { const item = await call({ tool, arguments: read }); return item.isError ? { ok: false, error: item.structuredContent } : { ok: true, result: item.structuredContent }; }));
      return result({ results });
    }
    const entry = entries.find((item) => (item.tool === tool || item.tool === `${tool}:${args.tool}`) && partialMatch(item.match ?? {}, args));
    onCall({ tool, pending: entry?.response.pending === true });
    if (tool === 'automation_run_status' && writes.has(args.trigger_id)) return result(writes.get(args.trigger_id));
    if (!entry && tool === 'viewer_context') return result({ viewerRole: viewer.role, viewerDisplayName: viewer.displayName, orgDisplayName: 'Synthetic fixture org' });
    const write = isWrite(tool);
    if (!entry && !write) {
      onMissing(tool, args);
      return failure('fixture_missing', `Missing fixture: ${tool}`);
    }
    const response = entry?.response ?? { write: 'success', message: 'Logged fixture write; nothing was written.' };
    if (response.pending) return new Promise(() => {});
    if (response.error) return failure(response.error.code, response.error.message);
    if (response.denied) return { isError: true, content: [{ type: 'text', text: 'Fixture tool denied' }], structuredContent: { error: { code: 'surface_tool_denied' } } };
    if (response.viewer_unavailable) return failure('viewer_unavailable', 'Fixture viewer unavailable');
    if (response.write) {
      onWrite(tool, response);
      const status = response.write === 'failed' ? 'failed' : 'success';
      if (admission(tool) === 'conversation_command') return result(response.write === 'success' ? { outcome: 'applied' } : response.write === 'refused' ? { outcome: 'refused', reason: 'not_owner' } : { outcome: 'unknown' });
      const trigger_id = `fixture-${++count}`;
      writes.set(trigger_id, { status, rowsAffected: response.write === 'success' ? 1 : 0 });
      return result({ trigger_id });
    }
    return result(response.data);
  };
  return call;
}
