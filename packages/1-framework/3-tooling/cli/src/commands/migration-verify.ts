import { attestMigration, verifyMigration } from '@prisma-next/migration-tools/attestation';
import { MigrationToolsError } from '@prisma-next/migration-tools/types';
import { ifDefined } from '@prisma-next/utils/defined';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { Command } from 'commander';
import { type CliStructuredError, errorRuntime, errorUnexpected } from '../utils/cli-errors';
import {
  addGlobalOptions,
  setCommandDescriptions,
  setCommandExamples,
} from '../utils/command-helpers';
import { formatMigrationVerifyCommandOutput } from '../utils/formatters/migrations';
import { formatStyledHeader } from '../utils/formatters/styled';
import type { CommonCommandOptions } from '../utils/global-flags';
import { type GlobalFlags, parseGlobalFlags } from '../utils/global-flags';
import { handleResult } from '../utils/result-handler';
import { TerminalUI } from '../utils/terminal-ui';

interface MigrationVerifyOptions extends CommonCommandOptions {
  readonly dir: string;
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
  ui: TerminalUI,
): Promise<Result<MigrationVerifyResult, CliStructuredError>> {
  const dir = options.dir;

  if (!flags.json && !flags.quiet) {
    const header = formatStyledHeader({
      command: 'migration verify',
      description: 'Verify migration package integrity',
      details: [{ label: 'dir', value: dir }],
      flags,
    });
    ui.stderr(header);
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
  setCommandExamples(command, ['prisma-next migration verify --dir migrations/20250101-add-users']);
  addGlobalOptions(command)
    .requiredOption('--dir <path>', 'Path to the migration package directory')
    .action(async (options: MigrationVerifyOptions) => {
      const flags = parseGlobalFlags(options);
      const ui = new TerminalUI({ color: flags.color, interactive: flags.interactive });

      const result = await executeMigrationVerifyCommand(options, flags, ui);

      const exitCode = handleResult(result, flags, ui, (verifyResult) => {
        if (flags.json) {
          ui.output(JSON.stringify(verifyResult, null, 2));
        } else if (!flags.quiet) {
          ui.log(formatMigrationVerifyCommandOutput(verifyResult, flags));
        }
      });

      process.exit(exitCode);
    });

  return command;
}
