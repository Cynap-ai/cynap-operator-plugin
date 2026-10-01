---
description: Run the org's tests locally in a read-only sandbox and report the verdict.
argument-hint: "[--dir <path>] [file…]"
---

# /cynap-test

```sh
node "${CLAUDE_PLUGIN_ROOT}/bin/cynap-test.mjs" $ARGUMENTS
```

Runs the org's tests from the pulled working directory (`./cynap-<org>/` by default, or
`--dir <path>`) with Node's built-in test runner. With no files named, every `*.test.ts`,
`*.test.mts`, `*.test.js`, `*.test.mjs` and `*.test.cjs` in the tree is checked; name files to check a subset. The runner pre-scans imports and skips unsupported files with a reason and suggested fix. It reports passed, failed and unsupported counts separately. Exit code `2` means every selected file was unsupported; ordinary test failures retain Node's nonzero exit code.

## Writing an org test

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMockContext } from '#cynap/testing';
import { buildInvoice } from '../lib/invoice.ts';

test('builds an invoice', async () => {
  const ctx = createMockContext();
  assert.equal((await buildInvoice(ctx)).total, 120);
});
```

- Use `node:test` and `node:assert/strict`. Snapshots use `t.assert.snapshot`. Vitest is unsupported; rewrite these tests using Node's built-in runner.
- Relative imports carry their `.ts` extension. Import types with `import type`. No enums,
  runtime namespaces or parameter properties — Node strips types, it does not compile them.
- `.js` and `.mjs` are ESM. Use `.cjs` for CommonJS tests that use `require()`.
- `#cynap/testing` is the Cynap test context. `/cynap-pull` installs it and owns the root
  `package.json` that maps it; neither is ever pushed.

## Sandboxed

Pulled test files are untrusted — another seat may have written them. They run in one Node
process that may only **read** the working directory: no file writes, no child processes, an
empty environment, and (on Node ≥ 25) no network. A test that needs any of those fails here.

Node ≥ 22.18 is required; an older Node is refused with the version it found.

## The verdict

The passed, failed and unsupported counts are for you. Nothing on the plane or in platform CI reads it, and it gates nothing.
