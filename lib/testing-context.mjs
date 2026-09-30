// Installs the org test context into a pulled working directory.
//
// Org tests import `#cynap/testing`. A package.json `imports` target must sit inside the package,
// so the plugin copies its bundled context to a fixed path under the reserved `.cynap/` directory
// and owns the ROOT package.json that maps the specifier to it. Neither path is ever synced: the
// three-way sync skips both, and the plane refuses them at commit — so an org can never remap
// `#cynap/testing` to code of its own.
//
// Zero dependencies — Node built-ins only.

import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { RESERVED_DIR, writeFileAtomic } from './workspace-sync.mjs';

export const TESTING_SPECIFIER = '#cynap/testing';
export const TESTING_BUNDLE_REL = `${RESERVED_DIR}/testing.mjs`;
export const ROOT_PACKAGE_JSON = 'package.json';
export const BUNDLED_TESTING_PATH = join(dirname(fileURLToPath(import.meta.url)), 'cynap-testing.mjs');

export function rootPackageJson() {
  return `${JSON.stringify(
    {
      private: true,
      type: 'module',
      description: 'Owned by the Cynap operator plugin — rewritten on every /cynap-pull, never committed.',
      imports: { [TESTING_SPECIFIER]: `./${TESTING_BUNDLE_REL}` },
    },
    null,
    2
  )}\n`;
}

/** Writes the bundle and the root package.json. Returns the two paths it owns. */
export function installTestingContext(dir, { bundlePath = BUNDLED_TESTING_PATH } = {}) {
  const bundleAbs = join(dir, TESTING_BUNDLE_REL);
  mkdirSync(dirname(bundleAbs), { recursive: true });
  copyFileSync(bundlePath, bundleAbs);
  writeFileAtomic(join(dir, ROOT_PACKAGE_JSON), Buffer.from(rootPackageJson()));
  return [TESTING_BUNDLE_REL, ROOT_PACKAGE_JSON];
}

/** True when the working directory's context matches the bundle this plugin ships. */
export function testingContextIsCurrent(dir, { bundlePath = BUNDLED_TESTING_PATH } = {}) {
  try {
    return (
      readFileSync(join(dir, TESTING_BUNDLE_REL)).equals(readFileSync(bundlePath)) &&
      readFileSync(join(dir, ROOT_PACKAGE_JSON), 'utf8') === rootPackageJson()
    );
  } catch {
    return false;
  }
}
