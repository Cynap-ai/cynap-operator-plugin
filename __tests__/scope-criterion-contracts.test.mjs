import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scopeCriterionContractProbe } from '../../lint/scope-criterion-contracts.mjs';
import { reduceCriterionResults, evaluateChecks } from '../bin/cynap-checks-core.mjs';

test('criterion contracts each have one owner in the mandatory operator gate', () => {
  const receipt = scopeCriterionContractProbe();
  assert.ok(receipt.scanned_files > 100);
  assert.equal(Object.keys(receipt.definitions).length, 4);
});
test('operator core keeps many-to-many and bypass semantics', () => {
  const suite = { id: 'a', assertions: [
    { op: 'file_exists', file: 'context/a.json', proves: ['a', 'b'] },
    { op: 'json_path_present', file: 'context/missing.json', path: '$', allow_absent: true, proves: ['a'] },
  ] };
  const results = evaluateChecks([suite], (path) => path.includes('missing') ? null : Buffer.from('{}'));
  const criteria = reduceCriterionResults({ criterionIds: ['a', 'b', 'c'], suites: [{ path: 'checks/a.check.json', digest: 'a'.repeat(64), suite }], results });
  assert.equal(criteria[0].status, 'uncovered');
  assert.equal(criteria[1].status, 'passed');
  assert.equal(criteria[2].status, 'uncovered');
  assert.equal(results.suites[0].assertions[1].bypassed, true);
});
