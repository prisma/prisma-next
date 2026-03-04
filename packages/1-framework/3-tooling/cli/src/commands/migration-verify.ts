import { attestMigration, verifyMigration } from '@prisma-next/migration-tools/attestation';
import { MigrationToolsError } from '@prisma-next/migration-tools/types';
import { ifDefined } from '@prisma-next/utils/defined';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { Command } from 'commander';
import { type CliStructuredError, errorRuntime, errorUnexpected } from '../utils/cli-errors';
import { setCommandDescriptions } from '../utils/command-helpers';
import { type GlobalFlags, parseGlobalFlags } from '../utils/global-flags';
import {
  formatCommandHelp,
  formatMigrationVerifyCommandOutput,
  formatStyledHeader,
} from '../utils/output';
import { handleResult } from '../utils/result-handler';

interface MigrationVerifyOptions {
  readonly dir: string;
  readonly json?: string | boolean;
  readonly quiet?: boolean;
  readonly q?: boolean;
  readonly verbose?: boolean;
  readonly v?: boolean;
  readonly vv?: boolean;
  readonly trace?: boolean;
  readonly timestamps?: boolean;
  readonly color?: boolean;
  readonly 'no-color'?: boolean;
}

export interface MigrationVerifyResult {
  readonly ok: boolean;
  readonly status: 'verified' | 'attested';
  readonly dir: string;
  readonly migrationId?: string;
  readonly storedMigrationId?: string;
  readonly computedMigrationId?: string;
  readonly summary: string;
}

async function executeMigrationVerifyCommand(
  options: MigrationVerifyOptions,
  flags: GlobalFlags,
): Promise<Result<MigrationVerifyResult, CliStructuredError>> {
  const dir = options.dir;

  if (flags.json !== 'object' && !flags.quiet) {
    const header = formatStyledHeader({
      command: 'migration verify',
      description: 'Verify migration package integrity',
      details: [{ label: 'dir', value: dir }],
      flags,
    });
    console.log(header);
  }

  try {
    const result = await verifyMigration(dir);

    if (result.ok) {
      return ok({
        ok: true,
        status: 'verified',
        dir,
        ...ifDefined('migrationId', result.storedMigrationId),
        ...ifDefined('storedMigrationId', result.storedMigrationId),
        ...ifDefined('computedMigrationId', result.computedMigrationId),
        summary: 'Migration package verified — migrationId matches',
      });
    }

    if (result.reason === 'draft') {
      const migrationId = await attestMigration(dir);
      return ok({
        ok: true,
        status: 'attested',
        dir,
        migrationId,
        summary: `Draft migration attested with migrationId: ${migrationId}`,
      });
    }

    return notOk(
      errorRuntime('migrationId mismatch — migration has been modified', {
        why: `stored=${result.storedMigrationId}, computed=${result.computedMigrationId}`,
        fix: 'If the change was intentional, set "migrationId" to null in migration.json and rerun `migration verify` to re-attest. Otherwise, restore the original migration.',
        meta: {
          storedMigrationId: result.storedMigrationId,
          computedMigrationId: result.computedMigrationId,
        },
      }),
    );
  } catch (error) {
    if (MigrationToolsError.is(error)) {
      return notOk(
        errorRuntime(error.message, {
          why: error.why,
          fix: error.fix,
          meta: { code: error.code, ...(error.details ?? {}) },
        }),
      );
    }
    return notOk(
      errorUnexpected(error instanceof Error ? error.message : String(error), {
        why: `Failed to verify migration: ${error instanceof Error ? error.message : String(error)}`,
      }),
    );
  }
}

export function createMigrationVerifyCommand(): Command {
  const command = new Command('verify');
  setCommandDescriptions(
    command,
    'Verify a migration package migrationId',
    'Recomputes the content-addressed migrationId for a migration package and compares\n' +
      'it against the stored value. Draft migrations (migrationId: null) are automatically\n' +
      'attested.',
  );
  command
    .configureHelp({
      formatHelp: (cmd) => {
        const defaultFlags = parseGlobalFlags({});
        return formatCommandHelp({ command: cmd, flags: defaultFlags });
      },
    })
    .requiredOption('--dir <path>', 'Path to the migration package directory')
    .option('--json [format]', 'Output as JSON (object)', false)
    .option('-q, --quiet', 'Quiet mode: errors only')
    .option('-v, --verbose', 'Verbose output')
    .option('-vv, --trace', 'Trace output')
    .option('--timestamps', 'Add timestamps to output')
    .option('--color', 'Force color output')
    .option('--no-color', 'Disable color output')
    .action(async (options: MigrationVerifyOptions) => {
      const flags = parseGlobalFlags(options);

      const result = await executeMigrationVerifyCommand(options, flags);

      const exitCode = handleResult(result, flags, (verifyResult) => {
        if (flags.json === 'object') {
          console.log(JSON.stringify(verifyResult, null, 2));
        } else if (!flags.quiet) {
          console.log(formatMigrationVerifyCommandOutput(verifyResult, flags));
        }
      });

      process.exit(exitCode);
    });

  return command;
}
