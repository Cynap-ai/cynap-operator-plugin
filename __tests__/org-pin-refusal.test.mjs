// CYN-785 (CYN-768 P0) — proves the PACKAGED proxy (bin/operator-proxy.mjs,
// the build-copy of tooling/operator/operator-proxy.mjs) preserves the
// client-side org-pin refusal: createTokenManager throws when targetOrgId
// !== allowedOrgId. This is defense-in-depth only (the authoritative
// boundary is server-side in [internal reference omitted from public mirror]
// resolveOrgAccess), but the packaged copy must not silently drop it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTokenManager, DEFAULT_TARGET_ORG_ID } from '../bin/operator-proxy.mjs';

test('createTokenManager throws when targetOrgId does not match allowedOrgId', () => {
  assert.throws(
    () =>
      createTokenManager({
        mintHost: 'https://staging.cynap.ai',
        targetOrgId: 'some-other-org-id',
        allowedOrgId: DEFAULT_TARGET_ORG_ID,
        getCookie: () => 'better-auth.session_token=abc',
      }),
    /Refusing targetOrgId/
  );
});

test('createTokenManager allows targetOrgId when it matches an explicit --allow-org override', () => {
  assert.doesNotThrow(() =>
    createTokenManager({
      mintHost: 'https://staging.cynap.ai',
      targetOrgId: 'acme-clinic-uk-real-org-id',
      allowedOrgId: 'acme-clinic-uk-real-org-id',
      getCookie: () => 'better-auth.session_token=abc',
    })
  );
});

test('createTokenManager allows the default cynap-e2e org id with no override', () => {
  assert.doesNotThrow(() =>
    createTokenManager({
      mintHost: 'https://staging.cynap.ai',
      targetOrgId: DEFAULT_TARGET_ORG_ID,
      getCookie: () => 'better-auth.session_token=abc',
    })
  );
});
