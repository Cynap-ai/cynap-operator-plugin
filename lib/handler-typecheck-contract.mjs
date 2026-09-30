// The ONE handler-typecheck contract: the pinned toolchain and the compiler options.
//
// Two runners check a handler source and must reach the same verdict for the same bytes:
//   - /cynap-checks on the operator's machine (lib/handler-typecheck.mjs), and
//   - the platform's `workspace_validate` / `workspace_commit` / handler-upload gate, which
//     imports THIS module and the bundled `@cynap/sdk` declarations beside it.
// Neither keeps its own copy of a pin or an option; both read them here. Only the layout-bound
// options (`typeRoots`, `paths`) are added per runner, because each places the same packages
// at a different root.
//
// Pure data — no imports beyond the generated SDK declarations, so the platform can bundle it.

import { SDK_TYPE_PINS } from './cynap-sdk-types.mjs';

/**
 * Node types track the handler runtime's Node major; `undici-types` is the one package they
 * import, pinned so both runners resolve the same copy; the rest come from the SDK build.
 */
export const TOOLCHAIN_PINS = Object.freeze({ ...SDK_TYPE_PINS, '@types/node': '22.20.4', 'undici-types': '6.21.0' });

/** `compilerOptions` in tsconfig (JSON) form, minus the layout-bound `typeRoots` and `paths`. */
export const HANDLER_COMPILER_OPTIONS = Object.freeze({
  strict: true,
  noEmit: true,
  allowImportingTsExtensions: true,
  target: 'ES2022',
  lib: Object.freeze(['ES2023']),
  module: 'ESNext',
  moduleResolution: 'Bundler',
  skipLibCheck: true,
  types: Object.freeze(['node']),
});

/** The full options for a runner whose `@types` live under `typeRoot` and SDK declarations under `sdkRoot`. */
export function handlerCompilerOptions({ typeRoot, sdkRoot }) {
  return {
    ...HANDLER_COMPILER_OPTIONS,
    lib: [...HANDLER_COMPILER_OPTIONS.lib],
    types: [...HANDLER_COMPILER_OPTIONS.types],
    typeRoots: [typeRoot],
    paths: { '@cynap/sdk': [`${sdkRoot}/index.d.ts`], '@cynap/sdk/*': [`${sdkRoot}/*`] },
  };
}
