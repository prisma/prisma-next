import { Command } from 'commander';
import {
  addGlobalOptions,
  setCommandDescriptions,
  setCommandExamples,
} from '../../utils/command-helpers';
import { type CommonCommandOptions, parseGlobalFlags } from '../../utils/global-flags';
import {
  INIT_EXIT_EMIT_FAILED,
  INIT_EXIT_INSTALL_FAILED,
  INIT_EXIT_INTERNAL_ERROR,
  INIT_EXIT_OK,
  INIT_EXIT_PRECONDITION,
  INIT_EXIT_USER_ABORTED,
} from './exit-codes';

/**
 * Commander.js parsed options for `init`. The init-specific options live
 * alongside the inherited `CommonCommandOptions` global flags.
 *
 * `target` and `authoring` are typed as plain `string` here because
 * Commander.js does not enforce enums at parse time — the validation /
 * normalisation happens in `inputs.ts::resolveInitInputs`, which can
 * raise a structured `errorInitInvalidFlagValue` with the full set of
 * allowed values.
 */
interface InitCommandOptions extends CommonCommandOptions {
  readonly target?: string;
  readonly authoring?: string;
  readonly schemaPath?: string;
  readonly force?: boolean;
  readonly writeEnv?: boolean;
  readonly probeDb?: boolean;
  readonly strictProbe?: boolean;
  readonly install?: boolean;
}

export function createInitCommand(): Command {
  const command = new Command('init');
  setCommandDescriptions(
    command,
    'Initialize a new Prisma Next project',
    'Scaffolds config, schema, and runtime files, installs dependencies,\n' +
      'and emits the contract. Gets you from zero to typed queries in one step.\n' +
      '\n' +
      'Run interactively for a guided experience, or supply --target / --authoring\n' +
      'and --yes for a fully scriptable run (CI, AI coding agents, automation).\n' +
      '\n' +
      'Exit codes (see CLI Style Guide § Exit Codes):\n' +
      `  ${INIT_EXIT_OK}   OK                    Init succeeded.\n` +
      `  ${INIT_EXIT_INTERNAL_ERROR}   INTERNAL_ERROR        Unexpected bug in prisma-next (please report).\n` +
      `  ${INIT_EXIT_PRECONDITION}   PRECONDITION          Bad flags / missing prerequisite (e.g. no package.json).\n` +
      `  ${INIT_EXIT_USER_ABORTED}   USER_ABORTED          User cancelled an interactive prompt.\n` +
      `  ${INIT_EXIT_INSTALL_FAILED}   INSTALL_FAILED        Dependency installation failed (init-specific).\n` +
      `  ${INIT_EXIT_EMIT_FAILED}   EMIT_FAILED           \`contract emit\` failed after install (init-specific).`,
  );
  setCommandExamples(command, [
    'prisma-next init',
    'prisma-next init --yes --target postgres --authoring psl',
    'prisma-next init --yes --target mongodb --authoring typescript --json',
    'prisma-next init --yes --force --target postgres --authoring psl  # overwrite an existing scaffold',
    'prisma-next init --no-install                                       # skip pnpm/npm install + emit',
  ]);

  return addGlobalOptions(command)
    .option('--target <db>', 'Database target: postgres or mongodb')
    .option('--authoring <style>', 'Schema authoring style: psl or typescript')
    .option(
      '--schema-path <path>',
      'Where to write the starter schema (default: prisma/contract.prisma)',
    )
    .option('--force', 'Overwrite an existing scaffold without prompting')
    .option(
      '--write-env',
      'Write a .env file from .env.example (gitignored; default: only .env.example)',
    )
    .option(
      '--probe-db',
      'Connect to DATABASE_URL once and check the server version against the target minimum (opt-in; off by default)',
    )
    .option(
      '--strict-probe',
      'Treat a failed --probe-db as fatal (no-op without --probe-db; init is offline-by-default)',
    )
    .option('--no-install', 'Skip dependency installation and contract emission')
    .action(async (options: InitCommandOptions) => {
      const { runInit } = await import('./init');
      const flags = parseGlobalFlags(options);
      const canPrompt = deriveCanPrompt({
        flagsInteractive: flags.interactive,
        optionInteractive: options.interactive,
        stdinIsTTY: Boolean(process.stdin.isTTY),
      });
      const exitCode = await runInit(process.cwd(), { options, flags, canPrompt });
      process.exit(exitCode);
    });
}

/**
 * Bridges the action handler's two TTY checks (stdout via `flags`, stdin
 * via `process.stdin.isTTY`) into the `canPrompt` boolean `runInit`
 * consumes.
 *
 * Per the [Style Guide § Interactivity](../../../../../../../docs/CLI%20Style%20Guide.md#interactivity):
 *
 * - `flags.interactive` governs *decoration* (TerminalUI, intro/outro,
 *   spinners) and is derived from stdout-TTY by `parseGlobalFlags`,
 *   honouring `--interactive` / `--no-interactive`.
 * - Prompting additionally requires a stdin TTY — closing stdin is a
 *   common signal in CI / agent environments even when stdout stays
 *   attached.
 * - `--interactive` is the explicit override: when the user passes it,
 *   we honour it (e.g. testing flows where stdin is stubbed).
 *
 * Exported so callers and tests can derive the same value without
 * touching `process` globals — F14 of the M1/M2 review.
 */
export function deriveCanPrompt(opts: {
  readonly flagsInteractive: boolean | undefined;
  readonly optionInteractive: boolean | undefined;
  readonly stdinIsTTY: boolean;
}): boolean {
  if (opts.optionInteractive === true) return true;
  if (opts.flagsInteractive === false) return false;
  return opts.stdinIsTTY;
}
