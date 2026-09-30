// The Node permission sandbox shared by /cynap-test and /cynap-run-script.
//
// Pulled org files are UNTRUSTED content — another seat may have authored them. Both commands
// therefore run them in a child `node --permission` whose only grant is reading the working
// directory: no file writes, no child processes, no workers, no native addons, no WASI, and (on
// runtimes whose permission model covers it) no network. The child also gets an EMPTY
// environment, so neither a credential in the operator's shell nor a NODE_OPTIONS that re-grants
// a permission reaches it.
//
// Zero dependencies — Node built-ins only.

/** The oldest Node that runs org tests: `.ts` type stripping is unflagged from 22.18. */
export const MIN_NODE_VERSION = '22.18.0';

function parseVersion(version) {
  const [major = 0, minor = 0, patch = 0] = String(version)
    .replace(/^v/, '')
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);
  return [major, minor, patch];
}

export function versionAtLeast(found, minimum) {
  const a = parseVersion(found);
  const b = parseVersion(minimum);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
}

/** Throws, naming the version found, when this Node is older than MIN_NODE_VERSION. */
export function assertSupportedNode(found = process.versions.node) {
  if (!versionAtLeast(found, MIN_NODE_VERSION)) {
    throw new Error(
      `Node ${found} is too old — org tests and operator scripts need Node >= ${MIN_NODE_VERSION}. Install a newer Node and re-run.`
    );
  }
}

/** True when this runtime's permission model gates network access (Node 25+). */
export function networkIsGated(flags = process.allowedNodeEnvironmentFlags) {
  return flags.has('--allow-net');
}

/**
 * Operator scripts need the network gate: without it a script could reach the local proxy, whose
 * token can commit. Throws, naming the version found, when this runtime cannot deny the network.
 */
export function assertNetworkGated(found = process.versions.node, flags = process.allowedNodeEnvironmentFlags) {
  if (!networkIsGated(flags)) {
    throw new Error(
      `Node ${found} cannot deny network access to a sandboxed script — operator scripts need Node >= 25. Install a newer Node and re-run.`
    );
  }
}

/**
 * The execArgv that puts a child Node into the sandbox. `readPaths` are the ONLY paths it may
 * read. Nothing else is granted, and a caller can not add a grant through this function.
 */
export function sandboxExecArgv(readPaths) {
  if (!Array.isArray(readPaths) || readPaths.length === 0) {
    throw new Error('sandboxExecArgv: at least one readable path is required');
  }
  return ['--permission', ...readPaths.map((path) => `--allow-fs-read=${path}`)];
}

/** Every flag that would widen the sandbox. A test asserts none reaches a child. */
export const FORBIDDEN_GRANTS = [
  '--allow-fs-write',
  '--allow-child-process',
  '--allow-worker',
  '--allow-addons',
  '--allow-wasi',
  '--allow-net',
];

/** The environment a sandboxed child gets: nothing from the operator's shell. */
export const SANDBOX_ENV = Object.freeze({});
