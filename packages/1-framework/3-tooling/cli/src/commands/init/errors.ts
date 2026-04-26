import { CliStructuredError } from '../../utils/cli-errors';

/**
 * No `package.json` / `deno.json` / `deno.jsonc` in the target directory.
 *
 * `init` cannot bootstrap a fresh project from a bare directory (NG1) — that
 * gap is tracked separately. The fix is for the user to run `npm init` (or
 * the equivalent for their package manager) first.
 */
export function errorInitMissingManifest(): CliStructuredError {
  return new CliStructuredError('5001', 'No project manifest found', {
    domain: 'CLI',
    why: 'No package.json or deno.json found in the target directory. `prisma-next init` requires an existing project to attach to.',
    fix: 'Initialize your project first (e.g. `npm init -y` or `deno init`), then re-run `prisma-next init`.',
    docsUrl: 'https://prisma-next.dev/docs/cli/init',
  });
}

/**
 * Re-init in non-interactive mode without `--force`. Distinct from the
 * decline-the-prompt path (which is `errorInitUserAborted`) because here
 * the user was never given the choice — `--force` is the contract.
 */
export function errorInitReinitNeedsForce(): CliStructuredError {
  return new CliStructuredError('5002', 'Project is already initialized', {
    domain: 'CLI',
    why: 'A `prisma-next.config.ts` already exists in this directory. Re-running `init` would overwrite the scaffolded files; in non-interactive mode `init` will not do that without `--force`.',
    fix: 'Pass `--force` to overwrite the existing scaffold, or run `init` interactively to confirm.',
    docsUrl: 'https://prisma-next.dev/docs/cli/init',
  });
}

/**
 * Non-interactive mode is missing one or more required inputs. Lists every
 * missing flag in the error so an agent / CI script can react without
 * needing to parse English.
 *
 * @param missing — kebab-case flag names without leading dashes
 * @param why — additional context (e.g. "stdin is not a TTY") that helps
 *              the user understand why interactive fallback was skipped.
 */
export function errorInitMissingFlags(options: {
  readonly missing: readonly string[];
  readonly why: string;
}): CliStructuredError {
  const flagList = options.missing.map((flag) => `--${flag}`).join(', ');
  const fixList = options.missing
    .map((flag) => {
      switch (flag) {
        case 'target':
          return '--target postgres|mongodb';
        case 'authoring':
          return '--authoring psl|typescript';
        case 'schema-path':
          return '--schema-path <path>';
        default:
          return `--${flag} <value>`;
      }
    })
    .join(' ');
  return new CliStructuredError('5003', 'Missing required flags', {
    domain: 'CLI',
    why: `${options.why} Missing required flag(s): ${flagList}.`,
    fix: `Re-run with the missing flag(s) supplied, e.g. \`prisma-next init --yes ${fixList}\`. Use \`prisma-next init --help\` to see every flag.`,
    docsUrl: 'https://prisma-next.dev/docs/cli/init',
    meta: { missingFlags: options.missing },
  });
}

/**
 * A flag value was supplied but is not in the allowed set. Lists the
 * allowed values in `meta` for machine-readable consumption.
 */
export function errorInitInvalidFlagValue(options: {
  readonly flag: string;
  readonly value: string;
  readonly allowed: readonly string[];
}): CliStructuredError {
  return new CliStructuredError('5004', `Invalid value for --${options.flag}`, {
    domain: 'CLI',
    why: `\`--${options.flag} ${options.value}\` is not one of: ${options.allowed.join(', ')}.`,
    fix: `Use one of: ${options.allowed.map((v) => `--${options.flag} ${v}`).join(', ')}.`,
    docsUrl: 'https://prisma-next.dev/docs/cli/init',
    meta: { flag: options.flag, value: options.value, allowed: options.allowed },
  });
}

/**
 * The user cancelled an interactive prompt (Ctrl-C, escape, declined a
 * selection). Distinct from `errorInitReinitNeedsForce` because that path
 * applies to non-interactive mode where the user was never given the
 * choice; this one is the generic "user said no" path. Maps to exit code
 * 3 (USER_ABORTED).
 */
export function errorInitUserAborted(): CliStructuredError {
  return new CliStructuredError('5006', 'Init cancelled', {
    domain: 'CLI',
    why: 'The interactive prompt was cancelled before all required inputs were supplied. No files were modified.',
    fix: 'Re-run `prisma-next init` and complete the prompts, or pass the required inputs as flags (see `--help`) for a non-interactive run.',
    severity: 'info',
  });
}

/**
 * `--strict-probe` was supplied without `--probe-db`. Per FR8.3 / NFR9
 * (offline-by-default), `--strict-probe` is a no-op without `--probe-db` —
 * but rather than silently ignoring it we tell the user what they probably
 * meant. Without this guard, the flag combination silently does nothing,
 * which is exactly the kind of "looks like it worked" trap that a strict
 * mode is supposed to prevent.
 */
export function errorInitStrictProbeWithoutProbe(): CliStructuredError {
  return new CliStructuredError('5005', '`--strict-probe` requires `--probe-db`', {
    domain: 'CLI',
    why: '`--strict-probe` only changes how a *failed* probe is reported; without `--probe-db` no probe is attempted in the first place. (`init` is offline-by-default — it never opens a connection to your database without explicit consent.)',
    fix: 'Add `--probe-db` to opt in to the probe, or drop `--strict-probe` if you do not need the version check.',
    docsUrl: 'https://prisma-next.dev/docs/cli/init',
  });
}

/**
 * Dependency installation failed and the pnpm → npm fallback (FR7.2)
 * either did not apply (pm ≠ pnpm or stderr did not match a recognised
 * leak) or also failed. Files scaffolded before the install step are
 * already on disk; `meta.filesWritten` carries the list so a follow-up
 * agent can resume manually. Maps to exit code `4 = INSTALL_FAILED`.
 */
export function errorInitInstallFailed(options: {
  readonly addCommand: string;
  readonly addDevCommand: string;
  readonly emitCommand: string;
  readonly filesWritten: readonly string[];
  readonly stderrLines: readonly string[];
}): CliStructuredError {
  const trimmed = options.stderrLines.map((s) => s.trim()).filter(Boolean);
  const why =
    trimmed.length === 0
      ? 'The package manager exited with an error and no recoverable fallback applied.'
      : `The package manager exited with: ${trimmed[0]}`;
  return new CliStructuredError('5007', 'Failed to install dependencies', {
    domain: 'CLI',
    why,
    fix: `Install manually:\n  ${options.addCommand}\n  ${options.addDevCommand}\nThen run \`${options.emitCommand}\` to emit the contract.`,
    docsUrl: 'https://prisma-next.dev/docs/cli/init',
    meta: {
      filesWritten: options.filesWritten,
      stderr: trimmed,
    },
  });
}

/**
 * The user's project manifest (typically `package.json`) failed to parse
 * as JSON. Init reads the manifest to merge `scripts` (FR3.5) and to
 * skip `@types/node` when it is already declared (FR2.1); a malformed
 * file would otherwise surface as an `INTERNAL_ERROR` with a raw
 * `SyntaxError` stack, which violates the FR1.6 contract that every
 * documented failure mode maps to a stable exit code.
 *
 * Maps to exit code `2 = PRECONDITION` — the user can fix the manifest
 * and re-run.
 */
export function errorInitInvalidManifest(options: {
  readonly path: string;
  readonly cause: string;
}): CliStructuredError {
  return new CliStructuredError('5010', `Failed to parse ${options.path}`, {
    domain: 'CLI',
    why: `\`${options.path}\` is not valid JSON: ${options.cause}`,
    fix: `Fix the JSON syntax in \`${options.path}\` (a missing comma or unbalanced brace is the most common cause), then re-run \`prisma-next init\`.`,
    docsUrl: 'https://prisma-next.dev/docs/cli/init',
    meta: { path: options.path, cause: options.cause },
  });
}

/**
 * `prisma-next contract emit` failed after a successful install. Surface
 * the underlying error so the user can fix it and re-run; files and
 * dependencies remain on disk untouched. Maps to exit code
 * `5 = EMIT_FAILED`.
 */
export function errorInitEmitFailed(options: {
  readonly emitCommand: string;
  readonly filesWritten: readonly string[];
  readonly cause: string;
}): CliStructuredError {
  return new CliStructuredError('5008', 'Failed to emit contract', {
    domain: 'CLI',
    why: `\`prisma-next contract emit\` failed: ${options.cause}`,
    fix: `Inspect your contract file, fix the underlying issue, then re-run \`${options.emitCommand}\`. Pass \`-v\` for the full error envelope.`,
    docsUrl: 'https://prisma-next.dev/docs/cli/contract-emit',
    meta: {
      filesWritten: options.filesWritten,
      cause: options.cause,
    },
  });
}
