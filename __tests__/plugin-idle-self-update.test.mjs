// The proxy self-updates to a newer installed build while IDLE, never
// mid-call. Every seam is injected: no `claude` CLI, no process spawn, no timers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createInFlightTracker, runIdleSelfUpdate } from '../bin/operator-proxy.mjs';

const sink = () => ({ lines: [], write(line) { this.lines.push(line); } });

function harness({ running = '0.19.60', installed = '0.19.61', busy = () => false, busyAfterUpdate = null } = {}) {
  const calls = [];
  let updated = false;
  const deps = {
    pluginVersion: running,
    cwd: '/w',
    inFlightCount: () => (updated && busyAfterUpdate !== null ? busyAfterUpdate : busy() ? 1 : 0),
    update: async () => {
      calls.push('update');
      updated = true;
      return { ok: true, reason: 'updated' };
    },
    readInstalled: async () => (installed === null ? null : { version: installed, installPath: '/cache' }),
    restart: async (record) => {
      calls.push(`restart:${record.version}`);
    },
    out: sink(),
  };
  return { deps, calls };
}

test('the in-flight tracker counts a request until its response closes, including an abort', () => {
  const tracker = createInFlightTracker();
  const first = new EventEmitter();
  const second = new EventEmitter();
  tracker.begin(first);
  tracker.begin(second);
  assert.equal(tracker.count(), 2);
  first.emit('close');
  assert.equal(tracker.count(), 1);
  second.emit('close');
  assert.equal(tracker.count(), 0);
  second.emit('close');
  assert.equal(tracker.count(), 0, 'a repeated close never drives the count negative');
});

test('idle with a newer installed build: updates, then restarts into it', async () => {
  const { deps, calls } = harness();
  assert.equal(await runIdleSelfUpdate(deps), 'restarting');
  assert.deepEqual(calls, ['update', 'restart:0.19.61']);
});

test('a request in flight at the start: nothing runs at all', async () => {
  const { deps, calls } = harness({ busy: () => true });
  assert.equal(await runIdleSelfUpdate(deps), 'busy');
  assert.deepEqual(calls, []);
});

test('a request that arrives while the update runs: the restart is withheld', async () => {
  const { deps, calls } = harness({ busyAfterUpdate: 1 });
  assert.equal(await runIdleSelfUpdate(deps), 'busy');
  assert.deepEqual(calls, ['update']);
});

test('the installed build is not newer than the running one: no restart', async () => {
  for (const installed of ['0.19.60', '0.19.59']) {
    const { deps, calls } = harness({ installed });
    assert.equal(await runIdleSelfUpdate(deps), 'current', installed);
    assert.deepEqual(calls, ['update']);
  }
});

test('an unreadable installed record never restarts', async () => {
  const { deps, calls } = harness({ installed: null });
  assert.equal(await runIdleSelfUpdate(deps), 'no_installed_record');
  assert.deepEqual(calls, ['update']);
});
