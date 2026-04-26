import { Command } from 'commander';
import {
  addGlobalOptions,
  setCommandDescriptions,
  setCommandExamples,
} from '../../utils/command-helpers';
import { type CommonCommandOptions, parseGlobalFlags } from '../../utils/global-flags';

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
      'and --yes for a fully scriptable run (CI, AI coding agents, automation).',
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
      const baseFlags = parseGlobalFlags(options);
      // `parseGlobalFlags` derives `interactive` from stdout TTY — for
      // `init` specifically, prompts also need a stdin TTY (closing stdin
      // is a common signal in CI / agent environments). Downgrade to
      // non-interactive whenever stdin is not a TTY, *unless* the user
      // explicitly passed `--interactive` to override.
      const interactive =
        baseFlags.interactive !== false &&
        (options.interactive === true || Boolean(process.stdin.isTTY));
      const flags = { ...baseFlags, interactive };
      const exitCode = await runInit(process.cwd(), { options, flags });
      process.exit(exitCode);
    });
}
