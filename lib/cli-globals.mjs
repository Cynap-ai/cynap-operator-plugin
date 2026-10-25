// Flags every /cynap-* command shares: `--help` / `-h` and `--org <slug>`. Zero-dep (Node built-ins
// only), like the rest of lib/, because the commands run from a clean-machine HOME.
//
// `--org` only names WHICH connected org's proxy the command talks to, the same choice the working
// directory makes today. It carries no credential and widens nothing: the proxy for that org holds
// the credential, and a workspace saved for another org is still refused by `assertConnectedOrg`.

import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The env var `--org` sets so `resolveOrgSlug` (and every command that calls it) sees the choice. */
export const ORG_ENV = 'CYNAP_OPERATOR_ORG';
const ORG_SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** Maps a bin file to its command doc where the two names differ. */
const COMMAND_DOC = Object.freeze({ 'cynap-checks-runner': 'cynap-checks' });

export function isValidOrgSlug(value) {
  return typeof value === 'string' && ORG_SLUG.test(value);
}

/**
 * Splits the shared flags off `argv`. `--help` counts anywhere before a bare `--`; `-h` counts only
 * as the sole argument, so a script argument spelled `-h` is never swallowed.
 * Throws a usage error for `--org` without a valid slug.
 */
export function splitGlobalFlags(argv) {
  const rest = [];
  let org = null;
  let help = false;
  const end = argv.indexOf('--');
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (end !== -1 && i >= end) { rest.push(arg); continue; }
    if (arg === '--help' || (arg === '-h' && argv.length === 1)) { help = true; continue; }
    if (arg === '--org' || arg.startsWith('--org=')) {
      const value = arg === '--org' ? argv[++i] : arg.slice('--org='.length);
      if (!isValidOrgSlug(value)) {
        throw Object.assign(new Error('--org needs a connected org slug (lowercase letters, digits, hyphens), e.g. --org cynap-e2e'), { code: 'usage' });
      }
      org = value;
      continue;
    }
    rest.push(arg);
  }
  return { argv: rest, org, help };
}

/** The command's own doc, minus the plugin-root boilerplate, for `--help`. Falls back to a one-liner. */
export function helpText(binUrl) {
  const name = basename(fileURLToPath(binUrl), '.mjs');
  const doc = join(dirname(fileURLToPath(binUrl)), '..', 'commands', `${COMMAND_DOC[name] ?? name}.md`);
  const shared = 'Shared flags: --help, --org <slug> (run from any folder against that connected org).\n';
  if (!existsSync(doc)) return `${name}: no help text is installed for this command.\n${shared}`;
  const raw = readFileSync(doc, 'utf8');
  const front = /^---\n([\s\S]*?)\n---\n/.exec(raw);
  const field = (key) => new RegExp(`^${key}:\\s*"?(.*?)"?\\s*$`, 'm').exec(front?.[1] ?? '')?.[1];
  const body = raw.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
  const usage = field('argument-hint');
  return `${name}${usage ? ` ${usage}` : ''}\n${field('description') ?? ''}\n\n${body}\n\n${shared}`;
}

/**
 * Entry-point guard: call once, before `main()`, from a bin's "run as a script" branch. Handles
 * `--help` (prints and exits 0), exports `--org` as `CYNAP_OPERATOR_ORG`, and rewrites
 * `process.argv` so the command's own parser never sees the shared flags.
 */
export function applyGlobalFlags(binUrl, { argv = process.argv, env = process.env, out = process.stdout, exit = process.exit } = {}) {
  let split;
  try {
    split = splitGlobalFlags(argv.slice(2));
  } catch (error) {
    process.stderr.write(`${basename(fileURLToPath(binUrl), '.mjs')}: ${error.message}\n`);
    exit(1);
    return;
  }
  if (split.help) {
    out.write(helpText(binUrl));
    exit(0);
    return;
  }
  if (split.org) env[ORG_ENV] = split.org;
  argv.splice(2, argv.length - 2, ...split.argv);
}
