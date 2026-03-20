import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import type { CoreSchemaView } from '@prisma-next/core-control-plane/schema-view';
import type { IntrospectSchemaResult } from '@prisma-next/core-control-plane/types';
import { createPostgresTypeMap, extractEnumTypeNames, printPsl } from '@prisma-next/psl-printer';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { type as arktype } from 'arktype';
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
type PrintableSqlAnnotations = Readonly<Record<string, unknown>>;
type PrintablePrimaryKey = {
  readonly columns: readonly string[];
  readonly name?: string;
};
type PrintableSqlColumn = {
  readonly name: string;
  readonly nativeType: string;
  readonly nullable: boolean;
  readonly default?: string;
  readonly annotations?: PrintableSqlAnnotations;
};
type PrintableSqlForeignKey = {
  readonly columns: readonly string[];
  readonly referencedTable: string;
  readonly referencedColumns: readonly string[];
  readonly name?: string;
  readonly onDelete?: 'noAction' | 'restrict' | 'cascade' | 'setNull' | 'setDefault';
  readonly onUpdate?: 'noAction' | 'restrict' | 'cascade' | 'setNull' | 'setDefault';
  readonly annotations?: PrintableSqlAnnotations;
};
type PrintableSqlUnique = {
  readonly columns: readonly string[];
  readonly name?: string;
  readonly annotations?: PrintableSqlAnnotations;
};
type PrintableSqlIndex = {
  readonly columns: readonly string[];
  readonly name?: string;
  readonly unique: boolean;
  readonly annotations?: PrintableSqlAnnotations;
};
type PrintableSqlTable = {
  readonly name: string;
  readonly columns: Record<string, PrintableSqlColumn>;
  readonly primaryKey?: PrintablePrimaryKey;
  readonly foreignKeys: readonly PrintableSqlForeignKey[];
  readonly uniques: readonly PrintableSqlUnique[];
  readonly indexes: readonly PrintableSqlIndex[];
  readonly annotations?: PrintableSqlAnnotations;
};
type PrintableDependency = {
  readonly id: string;
};

const SqlAnnotationsSchema = arktype({
  '[string]': 'unknown',
});

const PrimaryKeySchema = arktype.declare<PrintablePrimaryKey>().type({
  columns: arktype.string.array().readonly(),
  'name?': 'string',
});

const SqlColumnSchema = arktype.declare<PrintableSqlColumn>().type({
  name: 'string',
  nativeType: 'string',
  nullable: 'boolean',
  'default?': 'string',
  'annotations?': SqlAnnotationsSchema,
});

const SqlForeignKeySchema = arktype.declare<PrintableSqlForeignKey>().type({
  columns: arktype.string.array().readonly(),
  referencedTable: 'string',
  referencedColumns: arktype.string.array().readonly(),
  'name?': 'string',
  'onDelete?': "'noAction' | 'restrict' | 'cascade' | 'setNull' | 'setDefault'",
  'onUpdate?': "'noAction' | 'restrict' | 'cascade' | 'setNull' | 'setDefault'",
  'annotations?': SqlAnnotationsSchema,
});

const SqlUniqueSchema = arktype.declare<PrintableSqlUnique>().type({
  columns: arktype.string.array().readonly(),
  'name?': 'string',
  'annotations?': SqlAnnotationsSchema,
});

const SqlIndexSchema = arktype.declare<PrintableSqlIndex>().type({
  columns: arktype.string.array().readonly(),
  unique: 'boolean',
  'name?': 'string',
  'annotations?': SqlAnnotationsSchema,
});

const SqlTableSchema = arktype.declare<PrintableSqlTable>().type({
  name: 'string',
  columns: arktype({ '[string]': SqlColumnSchema }),
  'primaryKey?': PrimaryKeySchema,
  foreignKeys: SqlForeignKeySchema.array().readonly(),
  uniques: SqlUniqueSchema.array().readonly(),
  indexes: SqlIndexSchema.array().readonly(),
  'annotations?': SqlAnnotationsSchema,
});

const DependencySchema = arktype.declare<PrintableDependency>().type({
  id: 'string',
});

const PrintableSqlSchemaIRSchema = arktype.declare<PrintableSqlSchemaIR>().type({
  tables: arktype({ '[string]': SqlTableSchema }),
  'annotations?': SqlAnnotationsSchema,
  dependencies: DependencySchema.array().readonly(),
});

function validatePrintableSqlSchemaIR(value: unknown): PrintableSqlSchemaIR {
  const result = PrintableSqlSchemaIRSchema(value);
  if (result instanceof arktype.errors) {
    const messages = result.map((problem: { message: string }) => problem.message).join('; ');
    throw errorUnexpected('Introspection returned an unexpected schema shape', {
      why: `Introspection returned an unexpected schema shape: ${messages}`,
    });
  }
  return result;
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
    const printableSchemaIR = validatePrintableSqlSchemaIR(schemaIR);

    // Call toSchemaView to convert schema IR to CoreSchemaView for tree rendering
    const schemaView = client.toSchemaView(printableSchemaIR);

    const totalTime = Date.now() - startTime;

    // Get masked connection URL for meta (only for string connections)
    const connectionForMeta =
      typeof dbConnection === 'string' ? maskConnectionUrl(dbConnection) : undefined;

    // Generate and write PSL file (unless --dry-run)
    let pslPath: string | undefined;

    if (!options.dryRun) {
      const outputPath = resolveDbIntrospectOutputPath(options, config.contract?.output);
      const enumTypeNames = extractEnumTypeNames(printableSchemaIR.annotations);
      const typeMap = createPostgresTypeMap(enumTypeNames);
      const pslContent = printPsl(printableSchemaIR, { typeMap });

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
      schema: printableSchemaIR,
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
      'preview the schema as a tree view without writing any file. Use\n' +
      '`db verify` to compare the live schema against your contract.',
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
