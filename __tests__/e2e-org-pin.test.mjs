// The headless `--staging --e2e` leg pins ITSELF to the reserved test
// org. Before the fix it relied on a caller-supplied `--allow-org`, so a bare
// `operator-proxy --staging --e2e --org-slug cynap-e2e` died at
// createTokenManager with `org_unknown`. Also pins the staging SSO bypass
// precedence: env names first (incl. the repo's VERCEL_BYPASS_TOKEN), Keychain last.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CYNAP_E2E_ORG_ID,
  CYNAP_E2E_ORG_SLUG,
  createTokenManager,
  hydrateBypassSecretFromKeychain,
  parseArgs,
  resolveE2eOrgPin,
  stagingProtectionBypassHeaders,
} from '../bin/operator-proxy.mjs';

test('a bare --staging --e2e --org-slug cynap-e2e resolves the reserved org id', () => {
  const opts = parseArgs(['--staging', '--e2e', '--org-slug', 'cynap-e2e', '--port', '47391']);
  assert.equal(opts.targetOrgId, null, 'argv alone carries no org id — the regression precondition');
  const pin = resolveE2eOrgPin({ orgSlug: opts.orgSlug, allowedOrgId: opts.allowedOrgId });
  assert.deepEqual(pin, { orgSlug: CYNAP_E2E_ORG_SLUG, orgId: CYNAP_E2E_ORG_ID });
  // The resolved pin is exactly what createTokenManager needs to construct.
  assert.doesNotThrow(() =>
    createTokenManager({
      mintHost: 'https://staging.example',
      targetOrgId: pin.orgId,
      allowedOrgId: pin.orgId,
      getAuthHeaders: () => ({ Cookie: 'x=y' }),
    })
  );
});

test('the e2e pin defaults the slug to cynap-e2e when none is given', () => {
  assert.deepEqual(resolveE2eOrgPin({ orgSlug: null, allowedOrgId: null }), {
    orgSlug: 'cynap-e2e',
    orgId: CYNAP_E2E_ORG_ID,
  });
});

test('the e2e pin accepts the matching --allow-org the connect plugin passes', () => {
  assert.equal(resolveE2eOrgPin({ orgSlug: 'cynap-e2e', allowedOrgId: CYNAP_E2E_ORG_ID }).orgId, CYNAP_E2E_ORG_ID);
});

test('the e2e pin refuses any other slug', () => {
  assert.throws(() => resolveE2eOrgPin({ orgSlug: 'acme', allowedOrgId: null }), /refusing --org-slug acme/);
});

test('the e2e pin refuses an --allow-org naming another org', () => {
  assert.throws(
    () => resolveE2eOrgPin({ orgSlug: 'cynap-e2e', allowedOrgId: 'real-org-id' }),
    /refusing --allow-org real-org-id/
  );
});

test('VERCEL_BYPASS_TOKEN is honoured from env and outranks the Keychain', () => {
  const env = { VERCEL_BYPASS_TOKEN: 'from-env' };
  let keychainRead = false;
  const source = hydrateBypassSecretFromKeychain(env, () => {
    keychainRead = true;
    return 'from-keychain';
  });
  assert.equal(source, 'env');
  assert.equal(keychainRead, false, 'an env secret must short-circuit the Keychain read');
  assert.deepEqual(stagingProtectionBypassHeaders(env), { 'x-vercel-protection-bypass': 'from-env' });
});

test('CYNAP_STAGING_PROTECTION_BYPASS outranks VERCEL_BYPASS_TOKEN', () => {
  const env = { CYNAP_STAGING_PROTECTION_BYPASS: 'primary', VERCEL_BYPASS_TOKEN: 'secondary' };
  assert.deepEqual(stagingProtectionBypassHeaders(env), { 'x-vercel-protection-bypass': 'primary' });
});

test('the Keychain fills in only when no env name is set', () => {
  const env = {};
  assert.equal(hydrateBypassSecretFromKeychain(env, () => 'from-keychain'), 'keychain');
  assert.deepEqual(stagingProtectionBypassHeaders(env), { 'x-vercel-protection-bypass': 'from-keychain' });
});
