// A self-update restart hands the live operator credential to its successor
// instead of revoking it and opening a second browser consent (2026-09-23: the
// restarted proxy's consent timed out unattended and the org went dark). The
// credential travels over an inherited socket on the successor's fd 3 — never
// argv, env, disk or a log — and every failed handoff falls back to revoke +
// browser consent, saying so in the log.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Duplex } from 'node:stream';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  CREDENTIAL_HANDOFF_FD_ENV,
  acquireStartupCredential,
  createOperatorCredentialSession,
  credentialHandoffProblem,
  handOffCredential,
  receiveCredentialHandoff,
  restartIntoSuccessor,
} from '../bin/operator-proxy.mjs';
import { buildDetachedLaunchCommand } from '../lib/connect.mjs';

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROXY_URL = pathToFileURL(join(PLUGIN_ROOT, 'bin', 'operator-proxy.mjs')).href;
const MINT_HOST = 'https://cynap.ai';
const CREDENTIAL = 'octk_handoff-test-credential-0123456789';
const FUTURE = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
const HELD = { credential: CREDENTIAL, orgId: 'org-acme', expiresAt: FUTURE, orgSlug: 'acme', mintHost: MINT_HOST };

function recorder() {
  const lines = [];
  return { write: (s) => lines.push(s), text: () => lines.join('') };
}

/** A successor stand-in: the real receiveCredentialHandoff, run in a real
 * child launched through the real detached launch command. */
const SUCCESSOR_SOURCE = `
import { writeFileSync } from 'node:fs';
const [proxyUrl, resultPath, mode] = process.argv.slice(2);
const { receiveCredentialHandoff, CREDENTIAL_HANDOFF_FD_ENV } = await import(proxyUrl);
if (mode === 'ignore') { setTimeout(() => process.exit(0), 50); }
else {
  const handoff = await receiveCredentialHandoff({ orgSlug: 'acme', mintHost: '${MINT_HOST}' });
  writeFileSync(resultPath, JSON.stringify({
    record: handoff?.record ?? null,
    markerLeftInEnv: process.env[CREDENTIAL_HANDOFF_FD_ENV] !== undefined,
  }));
  handoff?.acknowledge();
}
`;

function successorFixture(t, mode = 'adopt') {
  const dir = mkdtempSync(join(tmpdir(), 'cynap-handoff-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const script = join(dir, 'successor.mjs');
  writeFileSync(script, SUCCESSOR_SOURCE);
  const resultPath = join(dir, 'result.json');
  const launchCommand = buildDetachedLaunchCommand({ proxyArgv: [script, PROXY_URL, resultPath, mode], workingDir: dir });
  return { dir, resultPath, launchRecord: { launchCommand } };
}

function recordingSpawn(calls) {
  return (command, args, options) => {
    calls.push({ command, args, env: options.env });
    return spawn(command, args, options);
  };
}

test('the successor adopts the credential over fd 3 through the real detached launch command', async (t) => {
  const { dir, resultPath, launchRecord } = successorFixture(t);
  const calls = [];
  const outcome = await handOffCredential({
    launchRecord,
    record: HELD,
    cwd: dir,
    spawnImpl: recordingSpawn(calls),
    ackTimeoutMs: 10_000,
  });

  assert.deepEqual(outcome, { ok: true, spawned: true, reason: 'adopted' });
  const result = JSON.parse(readFileSync(resultPath, 'utf8'));
  assert.deepEqual(result.record, { credential: CREDENTIAL, orgId: 'org-acme', expiresAt: FUTURE });
  assert.equal(result.markerLeftInEnv, false, 'the successor drops the fd marker so its children never inherit it');

  // Never in argv, never in env (both are visible to ps), never in the log.
  assert.equal(calls.length, 1);
  assert.doesNotMatch(JSON.stringify(calls[0].args), /octk_/);
  assert.equal(calls[0].env[CREDENTIAL_HANDOFF_FD_ENV], '3', 'the env names only the fd number');
  assert.ok(!Object.values(calls[0].env).some((value) => String(value).includes(CREDENTIAL)));
  const log = existsSync(join(dir, 'proxy.log')) ? readFileSync(join(dir, 'proxy.log'), 'utf8') : '';
  assert.doesNotMatch(log, /octk_/);
});

test('a successor that never reads the handoff is reported, so the predecessor can fall back', async (t) => {
  const { dir, launchRecord } = successorFixture(t, 'ignore');
  const outcome = await handOffCredential({ launchRecord, record: HELD, cwd: dir, ackTimeoutMs: 10_000 });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.spawned, true, 'a successor is running, so the caller must not launch a second one');
  // The successor closing its end surfaces as EOF on macOS and as EPIPE on Linux;
  // both are a failed handoff, which is all the predecessor needs to know.
  assert.ok(['channel_closed', 'channel_error'].includes(outcome.reason), outcome.reason);
});

function fakeChild() {
  const channel = new Duplex({ read() {}, write(_chunk, _enc, cb) { cb(); } });
  const child = new EventEmitter();
  child.stdio = [null, null, null, channel];
  child.unref = () => {};
  return { child, channel };
}

test('no acknowledgement within the bound is a failed handoff', async () => {
  const { child } = fakeChild();
  const outcome = await handOffCredential({
    launchRecord: { launchCommand: 'true' },
    record: HELD,
    spawnImpl: () => child,
    ackTimeoutMs: 20,
  });
  assert.deepEqual(outcome, { ok: false, spawned: true, reason: 'not_acknowledged' });
});

test('a launch record with no command never spawns', async () => {
  let spawned = false;
  const outcome = await handOffCredential({ launchRecord: {}, record: HELD, spawnImpl: () => { spawned = true; } });
  assert.deepEqual(outcome, { ok: false, spawned: false, reason: 'no_launch_record' });
  assert.equal(spawned, false);
});

// ── the successor's half ────────────────────────────────────────────────────

function socketStat() {
  return { isSocket: () => true, isFIFO: () => false };
}

function channelCarrying(line) {
  const channel = new Duplex({ read() {}, write(_chunk, _enc, cb) { cb(); } });
  if (line !== null) channel.push(`${line}\n`);
  return channel;
}

test('a normal start (no marker) reads nothing and logs nothing', async () => {
  const out = recorder();
  const handoff = await receiveCredentialHandoff({ orgSlug: 'acme', mintHost: MINT_HOST, env: {}, out });
  assert.equal(handoff, null);
  assert.equal(out.text(), '');
});

test('a marker naming a closed fd falls back to consent and says so', async () => {
  const out = recorder();
  const env = { [CREDENTIAL_HANDOFF_FD_ENV]: '3' };
  const handoff = await receiveCredentialHandoff({
    orgSlug: 'acme',
    mintHost: MINT_HOST,
    env,
    statFd: () => { throw Object.assign(new Error('EBADF'), { code: 'EBADF' }); },
    out,
  });
  assert.equal(handoff, null);
  assert.equal(env[CREDENTIAL_HANDOFF_FD_ENV], undefined);
  assert.match(out.text(), /credential handoff from the previous proxy failed \(fd_not_open\) — falling back to browser consent/);
});

test('a handoff for another org is refused without ever logging the credential', async () => {
  const out = recorder();
  const handoff = await receiveCredentialHandoff({
    orgSlug: 'acme',
    mintHost: MINT_HOST,
    env: { [CREDENTIAL_HANDOFF_FD_ENV]: '3' },
    statFd: socketStat,
    openChannel: () => channelCarrying(JSON.stringify({ v: 1, ...HELD, orgSlug: 'globex' })),
    out,
  });
  assert.equal(handoff, null);
  assert.match(out.text(), /\(org_slug_mismatch\) — falling back to browser consent/);
  assert.doesNotMatch(out.text(), /octk_/);
});

test('a valid handoff is returned and acknowledged over the same channel', async () => {
  const channel = channelCarrying(JSON.stringify({ v: 1, ...HELD }));
  const written = [];
  channel._write = (chunk, _enc, cb) => { written.push(String(chunk)); cb(); };
  const handoff = await receiveCredentialHandoff({
    orgSlug: 'acme',
    mintHost: MINT_HOST,
    env: { [CREDENTIAL_HANDOFF_FD_ENV]: '3' },
    statFd: socketStat,
    openChannel: () => channel,
    out: recorder(),
  });
  assert.deepEqual(handoff.record, { credential: CREDENTIAL, orgId: 'org-acme', expiresAt: FUTURE });
  handoff.acknowledge();
  assert.deepEqual(written, ['adopted\n']);
});

test('credentialHandoffProblem refuses every record that is not this successor\'s', () => {
  const now = Date.now();
  const ok = { v: 1, ...HELD };
  const expect = { orgSlug: 'acme', mintHost: MINT_HOST, nowMs: now };
  assert.equal(credentialHandoffProblem(ok, expect), null);
  assert.equal(credentialHandoffProblem({ ...ok, v: 2 }, expect), 'unknown_version');
  assert.equal(credentialHandoffProblem({ ...ok, credential: 'session-cookie' }, expect), 'not_a_cli_credential');
  assert.equal(credentialHandoffProblem({ ...ok, orgId: '' }, expect), 'no_org');
  assert.equal(credentialHandoffProblem({ ...ok, mintHost: 'https://staging.cynap.ai' }, expect), 'plane_mismatch');
  assert.equal(credentialHandoffProblem({ ...ok, expiresAt: new Date(now - 1000).toISOString() }, expect), 'expired');
});

// ── the restart decision ────────────────────────────────────────────────────

function restartHarness({ handed, revoked = true, relaunchOk = true }) {
  const events = [];
  const out = recorder();
  const input = {
    successor: { launchCommand: 'true' },
    releasePort: async () => { events.push('release'); },
    retire: async () => { events.push('revoke'); return { credentialRevoked: revoked }; },
    handOff: async () => { events.push('handoff'); return handed; },
    relaunch: () => { events.push('relaunch'); return { ok: relaunchOk }; },
    out,
  };
  return { events, out, input };
}

test('an adopted handoff exits cleanly WITHOUT revoking the credential', async () => {
  const { events, out, input } = restartHarness({ handed: { ok: true, spawned: true, reason: 'adopted' } });
  assert.equal(await restartIntoSuccessor({ ...input, held: HELD }), 0);
  assert.deepEqual(events, ['release', 'handoff']);
  assert.match(out.text(), /handed this proxy's credential to the successor/);
});

test('a failed handoff to a running successor revokes and logs the fallback, but never launches a twin', async () => {
  const { events, out, input } = restartHarness({ handed: { ok: false, spawned: true, reason: 'not_acknowledged' } });
  assert.equal(await restartIntoSuccessor({ ...input, held: HELD }), 0);
  assert.deepEqual(events, ['release', 'handoff', 'revoke']);
  assert.match(out.text(), /credential handoff failed \(not_acknowledged\) — falling back: revoking this credential; the successor will reopen browser consent/);
});

test('a handoff that never spawned revokes and then relaunches the successor the old way', async () => {
  const { events, input } = restartHarness({ handed: { ok: false, spawned: false, reason: 'spawn_failed' } });
  assert.equal(await restartIntoSuccessor({ ...input, held: HELD }), 0);
  assert.deepEqual(events, ['release', 'handoff', 'revoke', 'relaunch']);
});

test('a failed handoff whose revoke also fails exits non-zero and launches nothing', async () => {
  const { events, input } = restartHarness({ handed: { ok: false, spawned: false, reason: 'spawn_failed' }, revoked: false });
  assert.equal(await restartIntoSuccessor({ ...input, held: HELD }), 1);
  assert.deepEqual(events, ['release', 'handoff', 'revoke']);
});

test('with no credential held (the --e2e cookie leg) the restart is revoke → release → relaunch', async () => {
  const { events, input } = restartHarness({ handed: null });
  assert.equal(await restartIntoSuccessor({ ...input, held: null }), 0);
  assert.deepEqual(events, ['revoke', 'release', 'relaunch']);
});

// ── the successor's startup ─────────────────────────────────────────────────

test('a handed-over credential is adopted and acknowledged, and no browser consent opens', async () => {
  const events = [];
  const session = createOperatorCredentialSession({
    login: async () => { throw new Error('must not log in'); },
    mintHost: MINT_HOST,
    orgSlug: 'acme',
  });
  const outcome = await acquireStartupCredential({
    receiveHandoff: async () => ({
      record: { credential: CREDENTIAL, orgId: 'org-acme', expiresAt: FUTURE },
      acknowledge: () => events.push('ack'),
      decline: () => events.push('decline'),
    }),
    adopt: (record) => session.adopt(record),
    consent: async () => { events.push('consent'); },
    out: recorder(),
  });
  assert.equal(outcome, 'handed_over');
  assert.deepEqual(events, ['ack']);
  assert.deepEqual(session.getAuthHeaders(), { Authorization: `Bearer ${CREDENTIAL}` });
  assert.equal(session.current().orgId, 'org-acme');
});

test('a handoff that cannot be adopted is declined and falls back to one browser consent', async () => {
  const events = [];
  const outcome = await acquireStartupCredential({
    receiveHandoff: async () => ({
      record: { credential: CREDENTIAL, orgId: '' },
      acknowledge: () => events.push('ack'),
      decline: () => events.push('decline'),
    }),
    adopt: () => { throw new Error('the handed-over credential names no organization'); },
    consent: async () => { events.push('consent'); },
    out: recorder(),
  });
  assert.equal(outcome, 'consented');
  assert.deepEqual(events, ['decline', 'consent']);
});

test('adopt() never replaces a credential the session already holds', async () => {
  const session = createOperatorCredentialSession({
    login: async () => ({ credential: 'octk_first', orgId: 'org-acme' }),
    mintHost: MINT_HOST,
    orgSlug: 'acme',
    revoke: async () => {},
  });
  await session.renew();
  assert.throws(() => session.adopt({ credential: CREDENTIAL, orgId: 'org-acme' }), /already held/);
  assert.equal(session.current().credential, 'octk_first');
});
