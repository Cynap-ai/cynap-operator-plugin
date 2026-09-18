// Proves the PACKAGED proxy (bin/operator-proxy.mjs,
// the build-copy of operator-proxy.mjs) preserves the
// client-side org-pin refusal: createTokenManager throws when targetOrgId
// !== allowedOrgId. This is defense-in-depth only (the authoritative
// boundary is server-side in the platform service
// resolveOrgAccess), but the packaged copy must not silently drop it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTokenManager, CYNAP_E2E_ORG_ID } from '../bin/operator-proxy.mjs';

test('createTokenManager throws when targetOrgId does not match allowedOrgId', () => {
  assert.throws(
    () =>
      createTokenManager({
        mintHost: 'https://staging.cynap.ai',
        targetOrgId: 'some-other-org-id',
        allowedOrgId: CYNAP_E2E_ORG_ID,
        getAuthHeaders: () => ({ Authorization: 'Bearer <test>' }),
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
      getAuthHeaders: () => ({ Authorization: 'Bearer <test>' }),
    })
  );
});

test('createTokenManager allows the cynap-e2e org id when it is pinned explicitly', () => {
  assert.doesNotThrow(() =>
    createTokenManager({
      mintHost: 'https://staging.cynap.ai',
      targetOrgId: CYNAP_E2E_ORG_ID,
      allowedOrgId: CYNAP_E2E_ORG_ID,
      getAuthHeaders: () => ({ Authorization: 'Bearer <test>' }),
    })
  );
});
