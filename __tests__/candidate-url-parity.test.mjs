import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEST_PATH, renderCandidateUrl } from '../scripts/build-candidate-url.mjs';
import { candidateUrl } from '../lib/candidate-url.generated.mjs';

test('candidate URL module equals the SDK owner emitted by its generator', () => {
  assert.equal(readFileSync(DEST_PATH, 'utf8'), renderCandidateUrl());
});

test('candidate URL preserves absolute and relative routes', () => {
  assert.equal(candidateUrl(null, 'acme', 'a'.repeat(64), 'work-queue'), `/acme/_surface-candidate/${'a'.repeat(64)}/work-queue/`);
  assert.equal(candidateUrl(null, 'acme', 'a'.repeat(64), 'work-queue', 'queue'), `/acme/_surface-candidate/${'a'.repeat(64)}/work-queue/queue`);
  assert.equal(candidateUrl('https://staging.cynap.ai', 'acme', 'a'.repeat(64), 'work-queue'), `https://staging.cynap.ai/acme/_surface-candidate/${'a'.repeat(64)}/work-queue/`);
});
