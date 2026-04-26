import { existsSync } from 'node:fs';
import * as clack from '@clack/prompts';
import { extname, join, normalize } from 'pathe';
import type { GlobalFlags } from '../../utils/global-flags';
import {
  errorInitInvalidFlagValue,
  errorInitMissingFlags,
  errorInitReinitNeedsForce,
  errorInitStrictProbeWithoutProbe,
  errorInitUserAborted,
} from './errors';
import { type AuthoringId, defaultSchemaPath, type TargetId } from './templates/code-templates';

/**
 * Raw command-line input as Commander.js parses it. `target` here uses the
 * user-facing `mongodb` spelling (matching the flag); the internal
 * `TargetId` uses `mongo`. The mapping happens in `resolveInitInputs`.
 */
export interface InitFlagOptions {
  readonly target?: string;
  readonly authoring?: string;
  readonly schemaPath?: string;
  readonly force?: boolean;
  readonly writeEnv?: boolean;
  readonly probeDb?: boolean;
  readonly strictProbe?: boolean;
  readonly install?: boolean;
}

/**
 * The fully-resolved set of decisions `runInit` operates on. After this
 * value object is constructed, `runInit` should not need to consult the
 * environment again for any user-visible decision.
 */
export interface ResolvedInitInputs {
  readonly target: TargetId;
  readonly authoring: AuthoringId;
  readonly schemaPath: string;
  readonly install: boolean;
  readonly writeEnv: boolean;
  readonly probeDb: boolean;
  readonly strictProbe: boolean;
  /**
   * True if the project already has `prisma-next.config.ts` and the user
   * has agreed (or `--force` has been supplied) to overwrite it.
   */
  readonly reinit: boolean;
}

const TARGET_ALIASES: ReadonlyMap<string, TargetId> = new Map([
  ['postgres', 'postgres'],
  ['postgresql', 'postgres'],
  ['mongo', 'mongo'],
  ['mongodb', 'mongo'],
]);

const AUTHORING_VALUES: ReadonlyMap<string, AuthoringId> = new Map([
  ['psl', 'psl'],
  ['typescript', 'typescript'],
  ['ts', 'typescript'],
]);

/**
 * Resolves every required input for `runInit`. In interactive mode, missing
 * inputs are prompted via clack; in non-interactive mode, missing required
 * inputs throw a structured error listing exactly which flags are missing
 * (FR1.4). Throws `CliStructuredError` on any unrecoverable input issue.
 *
 * `canPrompt` is decoupled from `flags.interactive` so the action handler
 * (`./index.ts`) owns the merge of stdout-TTY (decoration) and stdin-TTY
 * (prompts). `flags.interactive` continues to gate `TerminalUI` decoration
 * — see [Style Guide § Interactivity](../../../../../../../docs/CLI%20Style%20Guide.md#interactivity).
 */
export async function resolveInitInputs(ctx: {
  readonly baseDir: string;
  readonly options: InitFlagOptions;
  readonly flags: GlobalFlags;
  readonly canPrompt: boolean;
}): Promise<ResolvedInitInputs> {
  const { baseDir, options, flags, canPrompt } = ctx;
  // `--force` and `--yes` are deliberately separate: `--force` is the
  // contract for "overwrite an existing scaffold" (works in both modes);
  // `--yes` only auto-accepts interactive prompts and never substitutes
  // for the explicit destructive opt-in. In non-interactive mode, `--yes`
  // alone does nothing useful; the user must supply `--target`,
  // `--authoring`, and (for re-init) `--force`.
  const force = Boolean(options.force);
  const autoAcceptPrompts = Boolean(flags.yes);

  // --strict-probe is a no-op without --probe-db; surface the mistake
  // rather than silently swallowing it (FR8.3 / NFR9).
  if (options.strictProbe && !options.probeDb) {
    throw errorInitStrictProbeWithoutProbe();
  }

  const reinit = await resolveReinit({ baseDir, force, canPrompt, autoAcceptPrompts });
  const target = resolveTarget(options.target);
  const authoring = resolveAuthoring(options.authoring);

  // Now collect what's still missing under non-interactive rules.
  const missing: string[] = [];
  if (target === undefined) missing.push('target');
  if (authoring === undefined) missing.push('authoring');

  if (!canPrompt && missing.length > 0) {
    const reason = process.stdin.isTTY
      ? 'Non-interactive mode is active (`--no-interactive` or stdout is piped).'
      : 'stdin is not a TTY, so `init` cannot prompt interactively.';
    throw errorInitMissingFlags({ missing, why: reason });
  }

  // Interactive path — fall back to clack for anything still missing.
  const finalTarget = target ?? (await promptTarget());
  const finalAuthoring = authoring ?? (await promptAuthoring());
  const finalSchemaPath =
    options.schemaPath !== undefined
      ? validateSchemaPath(options.schemaPath, finalAuthoring)
      : canPrompt
        ? await promptSchemaPath(finalAuthoring)
        : defaultSchemaPath(finalAuthoring);

  return {
    target: finalTarget,
    authoring: finalAuthoring,
    schemaPath: finalSchemaPath,
    install: options.install !== false,
    writeEnv: Boolean(options.writeEnv),
    probeDb: Boolean(options.probeDb),
    strictProbe: Boolean(options.strictProbe),
    reinit,
  };
}

async function resolveReinit(opts: {
  readonly baseDir: string;
  readonly force: boolean;
  readonly canPrompt: boolean;
  readonly autoAcceptPrompts: boolean;
}): Promise<boolean> {
  const configPath = join(opts.baseDir, 'prisma-next.config.ts');
  if (!existsSync(configPath)) {
    return false;
  }
  if (opts.force) {
    return true;
  }
  if (!opts.canPrompt) {
    throw errorInitReinitNeedsForce();
  }
  // In interactive mode, `--yes` auto-accepts the re-init confirm.
  if (opts.autoAcceptPrompts) {
    return true;
  }
  const result = await clack.confirm({
    message:
      'This project is already initialized. Re-initialize? This will overwrite all generated files.',
    initialValue: false,
    output: process.stderr,
  });
  if (clack.isCancel(result) || result !== true) {
    throw errorInitUserAborted();
  }
  return true;
}

function resolveTarget(value: string | undefined): TargetId | undefined {
  if (value === undefined) return undefined;
  const mapped = TARGET_ALIASES.get(value.toLowerCase());
  if (mapped === undefined) {
    throw errorInitInvalidFlagValue({
      flag: 'target',
      value,
      allowed: ['postgres', 'mongodb'],
    });
  }
  return mapped;
}

function resolveAuthoring(value: string | undefined): AuthoringId | undefined {
  if (value === undefined) return undefined;
  const mapped = AUTHORING_VALUES.get(value.toLowerCase());
  if (mapped === undefined) {
    throw errorInitInvalidFlagValue({
      flag: 'authoring',
      value,
      allowed: ['psl', 'typescript'],
    });
  }
  return mapped;
}

/**
 * Validates `--schema-path` against the chosen `--authoring` style: PSL
 * authoring requires a `.prisma` file and TypeScript authoring requires a
 * `.ts` file. Mismatched combinations would silently scaffold PSL content
 * into a `.ts` file (or vice versa); this validator surfaces the mistake
 * as a precondition error naming both flags.
 */
function validateSchemaPath(value: string, authoring: AuthoringId): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw errorInitInvalidFlagValue({
      flag: 'schema-path',
      value,
      allowed: ['<non-empty file path with .prisma or .ts extension>'],
    });
  }
  if (trimmed.endsWith('/') || trimmed.endsWith('\\')) {
    throw errorInitInvalidFlagValue({
      flag: 'schema-path',
      value,
      allowed: ['<file path, not a directory>'],
    });
  }
  const ext = extname(trimmed).toLowerCase();
  const expected = authoring === 'typescript' ? '.ts' : '.prisma';
  if (ext !== expected) {
    throw errorInitInvalidFlagValue({
      flag: 'schema-path',
      value,
      allowed: [`<file path ending in ${expected} for --authoring ${authoring}>`],
    });
  }
  return normalize(trimmed);
}

async function promptTarget(): Promise<TargetId> {
  const result = await clack.select({
    message: 'What database are you using?',
    options: [
      { value: 'postgres' as TargetId, label: 'PostgreSQL' },
      { value: 'mongo' as TargetId, label: 'MongoDB' },
    ],
    output: process.stderr,
  });
  if (clack.isCancel(result)) {
    throw errorInitUserAborted();
  }
  return result as TargetId;
}

async function promptAuthoring(): Promise<AuthoringId> {
  const result = await clack.select({
    message: 'How do you want to write your schema?',
    options: [
      { value: 'psl' as AuthoringId, label: 'Prisma Schema Language (.prisma)' },
      { value: 'typescript' as AuthoringId, label: 'TypeScript (.ts)' },
    ],
    output: process.stderr,
  });
  if (clack.isCancel(result)) {
    throw errorInitUserAborted();
  }
  return result as AuthoringId;
}

async function promptSchemaPath(authoring: AuthoringId): Promise<string> {
  const result = await clack.text({
    message: 'Where should the schema file go?',
    initialValue: defaultSchemaPath(authoring),
    validate(value = '') {
      const trimmed = value.trim();
      if (trimmed.length === 0) return 'Path cannot be empty';
      if (trimmed.endsWith('/') || trimmed.endsWith('\\'))
        return 'Path must be a file, not a directory';
      if (!extname(trimmed)) return 'Path must include a file extension (e.g. .prisma or .ts)';
      return undefined;
    },
    output: process.stderr,
  });
  if (clack.isCancel(result)) {
    throw errorInitUserAborted();
  }
  return normalize((result as string).trim());
}
