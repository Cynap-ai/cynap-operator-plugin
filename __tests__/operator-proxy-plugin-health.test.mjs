import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHealthPayload,
  createPluginSelfUpdateGuard,
  handlePluginOutdated,
} from '../bin/operator-proxy.mjs';

test('health carries an observed minimum without exposing a credential', () => {
  const payload = buildHealthPayload({
    ok: true,
    status: 'ready',
    org: 'acme',
    pluginVersion: '0.19.1',
    minimumPluginVersion: '0.19.2',
  });
  assert.equal(payload.minimumPluginVersion, '0.19.2');
  assert.equal(payload.credential, undefined);
});

test('health names the env portal origin for the /cynap-push candidate URL', () => {
  assert.equal(buildHealthPayload({ ok: true, status: 'ready', env: 'prod' }).mintHost, 'https://cynap.ai');
  assert.equal(buildHealthPayload({ ok: true, status: 'ready', env: 'staging' }).mintHost, 'https://staging.cynap.ai');
  assert.equal(buildHealthPayload({ ok: true, status: 'ready' }).mintHost, null);
});

test('successful self-update names the installed version and tells the operator to retry', async () => {
  const output = [];
  const outcome = await handlePluginOutdated({
    minimum: '0.19.2',
    pluginVersion: '0.19.1',
    guard: createPluginSelfUpdateGuard(),
    launchRecord: { launchCommand: 'node proxy.mjs' },
    runUpdate: async () => ({ ok: true }),
    readInstalled: async () => '0.19.3',
    out: { write: (line) => output.push(line) },
  });
  assert.equal(outcome, 'ready_to_restart');
  assert.match(output.join(''), /Plugin updated to 0\.19\.3; re-run the command/);
});
