import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import type { CoreSchemaView } from '@prisma-next/core-control-plane/schema-view';
import type { IntrospectSchemaResult } from '@prisma-next/core-control-plane/types';
import { createPostgresTypeMap, extractEnumTypeNames, printPsl } from '@prisma-next/psl-printer';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { Command } from 'commander';
import { dirname, relative, resolve } from 'pathe';
import { loadConfig } from '../config-loader';
import { createControlClient } from '../control-api/client';
import {
  CliStructuredError,
  errorDatabaseConnectionRequired,
  errorDriverRequired,
  errorUnexpected,
} from '../utils/cli-errors';
import {
  addGlobalOptions,
  maskConnectionUrl,
  setCommandDescriptions,
  setCommandExamples,
} from '../utils/command-helpers';
import { formatStyledHeader } from '../utils/formatters/styled';
import { formatIntrospectJson, formatIntrospectOutput } from '../utils/formatters/verify';
import type { CommonCommandOptions } from '../utils/global-flags';
import { type GlobalFlags, parseGlobalFlags } from '../utils/global-flags';
import { createProgressAdapter } from '../utils/progress-adapter';
import { handleResult } from '../utils/result-handler';
import { TerminalUI } from '../utils/terminal-ui';
import { resolveDbIntrospectOutputPath } from './db-introspect-paths';

interface DbIntrospectOptions extends CommonCommandOptions {
  readonly db?: string;
  readonly config?: string;
  readonly output?: string;
  readonly dryRun?: boolean;
}

interface DbIntrospectCommandResult {
  readonly introspectResult: IntrospectSchemaResult<unknown>;
  readonly schemaView: CoreSchemaView | undefined;
  readonly pslPath?: string | undefined;
}

type PrintableSqlSchemaIR = Parameters<typeof printPsl>[0];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function hasOptionalAnnotations(value: Record<string, unknown>): boolean {
  const annotations = value['annotations'];
  return annotations === undefined || isRecord(annotations);
}

function isPrimaryKeyLike(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const columns = value['columns'];
  const name = value['name'];
  return isStringArray(columns) && (name === undefined || typeof name === 'string');
}

function isSqlColumnLike(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const name = value['name'];
  const nativeType = value['nativeType'];
  const nullable = value['nullable'];
  return (
    typeof name === 'string' &&
    typeof nativeType === 'string' &&
    typeof nullable === 'boolean' &&
    hasOptionalAnnotations(value)
  );
}

function isSqlForeignKeyLike(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const columns = value['columns'];
  const referencedTable = value['referencedTable'];
  const referencedColumns = value['referencedColumns'];
  const name = value['name'];
  const onDelete = value['onDelete'];
  const onUpdate = value['onUpdate'];
  return (
    isStringArray(columns) &&
    typeof referencedTable === 'string' &&
    isStringArray(referencedColumns) &&
    (name === undefined || typeof name === 'string') &&
    (onDelete === undefined || typeof onDelete === 'string') &&
    (onUpdate === undefined || typeof onUpdate === 'string') &&
    hasOptionalAnnotations(value)
  );
}

function isSqlUniqueLike(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const columns = value['columns'];
  const name = value['name'];
  return (
    isStringArray(columns) &&
    (name === undefined || typeof name === 'string') &&
    hasOptionalAnnotations(value)
  );
}

function isSqlIndexLike(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const columns = value['columns'];
  const unique = value['unique'];
  const name = value['name'];
  return (
    isStringArray(columns) &&
    typeof unique === 'boolean' &&
    (name === undefined || typeof name === 'string') &&
    hasOptionalAnnotations(value)
  );
}

function isSqlTableLike(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const name = value['name'];
  const columns = value['columns'];
  const primaryKey = value['primaryKey'];
  const foreignKeys = value['foreignKeys'];
  const uniques = value['uniques'];
  const indexes = value['indexes'];
  return (
    typeof name === 'string' &&
    isRecord(columns) &&
    Object.values(columns).every(isSqlColumnLike) &&
    (primaryKey === undefined || isPrimaryKeyLike(primaryKey)) &&
    Array.isArray(foreignKeys) &&
    foreignKeys.every(isSqlForeignKeyLike) &&
    Array.isArray(uniques) &&
    uniques.every(isSqlUniqueLike) &&
    Array.isArray(indexes) &&
    indexes.every(isSqlIndexLike) &&
    hasOptionalAnnotations(value)
  );
}

function isDependencyLike(value: unknown): boolean {
  return isRecord(value) && typeof value['id'] === 'string';
}

function isPrintableSqlSchemaIR(value: unknown): value is PrintableSqlSchemaIR {
  if (!isRecord(value)) {
    return false;
  }
  const tables = value['tables'];
  const dependencies = value['dependencies'];
  const annotations = value['annotations'];
  return (
    isRecord(tables) &&
    Object.values(tables).every(isSqlTableLike) &&
    Array.isArray(dependencies) &&
    dependencies.every(isDependencyLike) &&
    (annotations === undefined || isRecord(annotations))
  );
}

/**
 * Executes the db introspect command and returns a structured Result.
 */
async function executeDbIntrospectCommand(
  options: DbIntrospectOptions,
  flags: GlobalFlags,
  ui: TerminalUI,
  startTime: number,
): Promise<Result<DbIntrospectCommandResult, CliStructuredError>> {
  // Load config
  const config = await loadConfig(options.config);
  const configPath = options.config
    ? relative(process.cwd(), resolve(options.config))
    : 'prisma-next.config.ts';

  // Output header
  if (!flags.json && !flags.quiet) {
    const details: Array<{ label: string; value: string }> = [
      { label: 'config', value: configPath },
    ];
    if (options.db) {
      details.push({ label: 'database', value: maskConnectionUrl(options.db) });
    } else if (config.db?.connection && typeof config.db.connection === 'string') {
      details.push({ label: 'database', value: maskConnectionUrl(config.db.connection) });
    }
    const header = formatStyledHeader({
      command: 'db introspect',
      description: 'Inspect the database schema and generate PSL',
      url: 'https://pris.ly/db-introspect',
      details,
      flags,
    });
    ui.stderr(header);
  }

  // Resolve database connection (--db flag or config.db.connection)
  const dbConnection = options.db ?? config.db?.connection;
  if (!dbConnection) {
    return notOk(
      errorDatabaseConnectionRequired({
        why: `Database connection is required for db introspect (set db.connection in ${configPath}, or pass --db <url>)`,
        commandName: 'db introspect',
      }),
    );
  }

  // Check for driver
  if (!config.driver) {
    return notOk(errorDriverRequired({ why: 'Config.driver is required for db introspect' }));
  }

  // Create control client
  const client = createControlClient({
    family: config.family,
    target: config.target,
    adapter: config.adapter,
    driver: config.driver,
    extensionPacks: config.extensionPacks ?? [],
  });

  // Create progress adapter
  const onProgress = createProgressAdapter({ ui, flags });

  try {
    // Introspect with connection and progress
    const schemaIR = await client.introspect({
      connection: dbConnection,
      onProgress,
    });

    // Call toSchemaView to convert schema IR to CoreSchemaView for tree rendering
    const schemaView = client.toSchemaView(schemaIR);

    const totalTime = Date.now() - startTime;

    // Get masked connection URL for meta (only for string connections)
    const connectionForMeta =
      typeof dbConnection === 'string' ? maskConnectionUrl(dbConnection) : undefined;

    // Generate and write PSL file (unless --dry-run)
    let pslPath: string | undefined;

    if (!options.dryRun) {
      const outputPath = resolveDbIntrospectOutputPath(options, config.contract?.output);

      // schemaIR is typed as `unknown` from the control client; validate shape before printing PSL.
      if (!isPrintableSqlSchemaIR(schemaIR)) {
        throw errorUnexpected('Introspection returned an unexpected schema shape');
      }
      const enumTypeNames = extractEnumTypeNames(schemaIR.annotations);
      const typeMap = createPostgresTypeMap(enumTypeNames);
      const pslContent = printPsl(schemaIR, { typeMap });

      // Warn if file exists
      if (existsSync(outputPath) && !flags.quiet) {
        ui.stderr(`\u26A0 Overwriting existing file: ${relative(process.cwd(), outputPath)}`);
      }

      // Ensure parent directory exists
      mkdirSync(dirname(outputPath), { recursive: true });

      // Write the file
      writeFileSync(outputPath, pslContent, 'utf-8');

      pslPath = relative(process.cwd(), outputPath);

      if (!flags.quiet) {
        ui.stderr(`\u2714 Schema written to ${pslPath}`);
      }
    }

    const introspectResult: IntrospectSchemaResult<unknown> = {
      ok: true,
      summary: 'Schema introspected successfully',
      target: {
        familyId: config.family.familyId,
        id: config.target.targetId,
      },
      schema: schemaIR,
      meta: {
        ...(configPath ? { configPath } : {}),
        ...(connectionForMeta ? { dbUrl: connectionForMeta } : {}),
      },
      timings: {
        total: totalTime,
      },
    };

    return ok({ introspectResult, schemaView, pslPath });
  } catch (error) {
    // Driver already throws CliStructuredError for connection failures
    if (error instanceof CliStructuredError) {
      return notOk(error);
    }

    // Wrap unexpected errors
    return notOk(
      errorUnexpected(error instanceof Error ? error.message : String(error), {
        why: `Unexpected error during db introspect: ${error instanceof Error ? error.message : String(error)}`,
      }),
    );
  } finally {
    await client.close();
  }
}

export function createDbIntrospectCommand(): Command {
  const command = new Command('introspect');
  setCommandDescriptions(
    command,
    'Inspect the database schema and generate PSL',
    'Reads the live database schema and writes a .prisma schema file.\n' +
      'By default, writes to the resolved output path. Use --dry-run to\n' +
      'preview the schema as a tree view without writing any file.',
  );
  setCommandExamples(command, [
    'prisma-next db introspect --db $DATABASE_URL',
    'prisma-next db introspect --db $DATABASE_URL --output ./prisma/schema.prisma',
    'prisma-next db introspect --db $DATABASE_URL --dry-run',
    'prisma-next db introspect --db $DATABASE_URL --json',
  ]);
  addGlobalOptions(command)
    .option('--db <url>', 'Database connection string')
    .option('--config <path>', 'Path to prisma-next.config.ts')
    .option('--output <path>', 'Write PSL file to the specified path')
    .option('--dry-run', 'Preview schema as tree view without writing file')
    .action(async (options: DbIntrospectOptions) => {
      const flags = parseGlobalFlags(options);
      const startTime = Date.now();

      const ui = new TerminalUI({ color: flags.color, interactive: flags.interactive });

      const result = await executeDbIntrospectCommand(options, flags, ui, startTime);

      // Handle result - formats output and returns exit code
      const exitCode = handleResult(result, flags, ui, (value) => {
        const { introspectResult, schemaView, pslPath } = value;
        if (flags.json) {
          // Add psl path to JSON output when file was written
          const jsonOutput = pslPath
            ? { ...introspectResult, psl: { path: pslPath } }
            : introspectResult;
          ui.output(formatIntrospectJson(jsonOutput as IntrospectSchemaResult<unknown>));
        } else if (options.dryRun) {
          // --dry-run: show tree view
          const output = formatIntrospectOutput(introspectResult, schemaView, flags);
          if (output) {
            ui.log(output);
          }
        }
        // Default (no --dry-run, no --json): PSL was already written, nothing more to display
      });
      process.exit(exitCode);
    });

  return command;
}
