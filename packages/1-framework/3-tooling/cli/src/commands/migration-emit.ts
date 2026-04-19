import { MigrationToolsError } from '@prisma-next/migration-tools/types';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { Command } from 'commander';
import { loadConfig } from '../config-loader';
import { emitMigration } from '../lib/migration-emit';
import {
  CliStructuredError,
  errorRuntime,
  errorTargetMigrationNotSupported,
  errorUnexpected,
} from '../utils/cli-errors';
import {
  addGlobalOptions,
  getTargetMigrations,
  setCommandDescriptions,
  setCommandExamples,
} from '../utils/command-helpers';
import { formatMigrationEmitCommandOutput } from '../utils/formatters/migrations';
import { formatStyledHeader } from '../utils/formatters/styled';
import { assertFrameworkComponentsCompatible } from '../utils/framework-components';
import type { CommonCommandOptions } from '../utils/global-flags';
import { type GlobalFlags, parseGlobalFlags } from '../utils/global-flags';
import { handleResult } from '../utils/result-handler';
import { TerminalUI } from '../utils/terminal-ui';

export interface MigrationEmitOptions extends CommonCommandOptions {
  readonly dir: string;
  readonly config?: string;
}

export interface MigrationEmitResult {
  readonly ok: boolean;
  readonly dir: string;
  readonly migrationId: string;
  readonly summary: string;
}

async function executeMigrationEmitCommand(
  options: MigrationEmitOptions,
  flags: GlobalFlags,
  ui: TerminalUI,
): Promise<Result<MigrationEmitResult, CliStructuredError>> {
  const dir = options.dir;

  if (!flags.json && !flags.quiet) {
    const header = formatStyledHeader({
      command: 'migration emit',
      description: 'Emit ops.json from migration.ts and compute migrationId',
      details: [{ label: 'dir', value: dir }],
      flags,
    });
    ui.stderr(header);
  }

  try {
    const config = await loadConfig(options.config);
    const migrations = getTargetMigrations(config.target);
    if (!migrations) {
      throw errorTargetMigrationNotSupported({
        why: `Target "${config.target.id}" does not support migrations`,
      });
    }
    const frameworkComponents = assertFrameworkComponentsCompatible(
      config.family.familyId,
      config.target.targetId,
      [config.target, config.adapter, ...(config.extensionPacks ?? [])],
    );

    const { migrationId } = await emitMigration(dir, {
      targetId: config.target.targetId,
      migrations,
      frameworkComponents,
    });

    return ok({
      ok: true,
      dir,
      migrationId,
      summary: `Emitted ops.json and attested migrationId: ${migrationId}`,
    });
  } catch (error) {
    if (CliStructuredError.is(error)) {
      return notOk(error);
    }
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
        why: `Failed to emit migration: ${error instanceof Error ? error.message : String(error)}`,
      }),
    );
  }
}

export function createMigrationEmitCommand(): Command {
  const command = new Command('emit');
  setCommandDescriptions(
    command,
    'Emit ops.json from migration.ts and compute migrationId',
    'Evaluates migration.ts in the package directory, resolves it to ops.json,\n' +
      'then computes and persists the content-addressed migrationId in manifest.json.',
  );
  setCommandExamples(command, ['prisma-next migration emit --dir migrations/20250101-add-users']);
  addGlobalOptions(command)
    .requiredOption('--dir <path>', 'Path to the migration package directory')
    .option('--config <path>', 'Path to prisma-next.config.ts')
    .action(async (options: MigrationEmitOptions) => {
      const flags = parseGlobalFlags(options);
      const ui = new TerminalUI({ color: flags.color, interactive: flags.interactive });

      const result = await executeMigrationEmitCommand(options, flags, ui);

      const exitCode = handleResult(result, flags, ui, (emitResult) => {
        if (flags.json) {
          ui.output(JSON.stringify(emitResult, null, 2));
        } else if (!flags.quiet) {
          ui.log(formatMigrationEmitCommandOutput(emitResult, flags));
        }
      });

      process.exit(exitCode);
    });

  return command;
}
