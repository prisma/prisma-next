import { attestMigration, verifyMigration } from '@prisma-next/migration-tools/attestation';
import { MigrationToolsError } from '@prisma-next/migration-tools/types';
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
  readonly edgeId?: string | undefined;
  readonly storedEdgeId?: string | undefined;
  readonly computedEdgeId?: string | undefined;
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
        edgeId: result.storedEdgeId,
        storedEdgeId: result.storedEdgeId,
        computedEdgeId: result.computedEdgeId,
        summary: 'Migration package verified — edgeId matches',
      });
    }

    if (result.reason === 'draft') {
      const edgeId = await attestMigration(dir);
      return ok({
        ok: true,
        status: 'attested',
        dir,
        edgeId,
        summary: `Draft migration attested with edgeId: ${edgeId}`,
      });
    }

    return notOk(
      errorRuntime('edgeId mismatch — migration has been modified', {
        why: `stored=${result.storedEdgeId}, computed=${result.computedEdgeId}`,
        fix: 'If the change was intentional, set "edgeId" to null in migration.json and rerun `migration verify` to re-attest. Otherwise, restore the original migration.',
        meta: { storedEdgeId: result.storedEdgeId, computedEdgeId: result.computedEdgeId },
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
    'Verify a migration package edgeId',
    'Recomputes the content-addressed edgeId for a migration package and compares\n' +
      'it against the stored value. Draft migrations (edgeId: null) are automatically\n' +
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
