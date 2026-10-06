import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('/cynap-checks loads no AI broker and makes no network call on its local fixture path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'checks-no-ai-'));
  const guard = join(dir, 'guard.mjs');
  writeFileSync(guard, `import { registerHooks, syncBuiltinESMExports } from 'node:module';
import http from 'node:http'; import https from 'node:https'; import net from 'node:net';
const refuse = () => { throw new Error('network must not run'); };
globalThis.fetch = refuse; http.request = refuse; https.request = refuse; net.connect = refuse; syncBuiltinESMExports();
registerHooks({ resolve(specifier, context, next) { if (/dev-ai|customer-ai-request-schema/.test(specifier)) throw new Error('AI broker must not load'); return next(specifier, context); } });`);
  try {
    const output = execFileSync(process.execPath, ['--import', guard,
      fileURLToPath(new URL('../bin/cynap-checks-runner.mjs', import.meta.url)), '--workdir', dir, '--typecheck-only'], { encoding: 'utf8' });
    assert.equal(JSON.parse(output).typecheck.status, 'pass');
    assert.doesNotMatch(output, /developer|readiness|real AI/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});


test('/cynap-checks evaluates fixtures and reports only its existing attestation', () => {
  const dir = mkdtempSync(join(tmpdir(), 'checks-attestation-'));
  const guard = join(dir, 'guard.mjs');
  mkdirSync(join(dir, 'checks'));
  writeFileSync(join(dir, 'fixture.json'), '{"synthetic":true}');
  writeFileSync(join(dir, 'checks/local.json'), JSON.stringify({ id: 'local', assertions: [{ op: 'json_path_equals', file: 'fixture.json', path: '$.synthetic', equals: true }] }));
  writeFileSync(guard, `import { registerHooks, syncBuiltinESMExports } from 'node:module';
import http from 'node:http'; import https from 'node:https'; import net from 'node:net';
const refuse = () => { throw new Error('network must not run'); };
http.request = refuse; https.request = refuse; net.connect = refuse; syncBuiltinESMExports();
registerHooks({ resolve(specifier, context, next) { if (/dev-ai|customer-ai-request-schema/.test(specifier)) throw new Error('AI broker must not load'); return next(specifier, context); } });
let calls = 0;
globalThis.fetch = async (_url, options) => { const request = JSON.parse(options.body); if (++calls !== 1 || request.params.name !== 'checks_verdict_report') throw new Error('only attestation may be reported'); return { ok: true, json: async () => ({ result: { structuredContent: { ok: true } } }) }; };`);
  try {
    const output = execFileSync(process.execPath, ['--import', guard,
      fileURLToPath(new URL('../bin/cynap-checks-runner.mjs', import.meta.url)), '--workdir', dir, '--commit-sha', 'a'.repeat(64)], { encoding: 'utf8' });
    const result = JSON.parse(output);
    assert.equal(result.status, 'pass');
    assert.equal(result.passed, 1);
    assert.equal(result.reported.ok, true);
    assert.doesNotMatch(output, /developer|readiness|real AI/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
