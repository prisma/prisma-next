import type { CoreSchemaView } from '@prisma-next/core-control-plane/schema-view';
import {
  type PslPrintableSqlSchemaIR,
  validatePrintableSqlSchemaIR,
} from '@prisma-next/psl-printer';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { relative, resolve } from 'pathe';
import { loadConfig } from '../config-loader';
import { createControlClient } from '../control-api/client';
import {
  CliStructuredError,
  errorDatabaseConnectionRequired,
  errorDriverRequired,
  errorUnexpected,
} from '../utils/cli-errors';
import { maskConnectionUrl } from '../utils/command-helpers';
import { formatStyledHeader } from '../utils/formatters/styled';
import type { CommonCommandOptions, GlobalFlags } from '../utils/global-flags';
import { createProgressAdapter } from '../utils/progress-adapter';
import type { TerminalUI } from '../utils/terminal-ui';

export interface InspectLiveSchemaOptions extends CommonCommandOptions {
  readonly db?: string;
  readonly config?: string;
}

interface InspectLiveSchemaContext {
  readonly commandName: string;
  readonly description: string;
  readonly url: string;
}

type LoadedCliConfig = Awaited<ReturnType<typeof loadConfig>>;

export interface InspectLiveSchemaResult {
  readonly config: LoadedCliConfig;
  readonly schema: PslPrintableSqlSchemaIR;
  readonly schemaView: CoreSchemaView | undefined;
  readonly target: {
    readonly familyId: string;
    readonly id: string;
  };
  readonly meta: {
    readonly configPath?: string;
    readonly dbUrl?: string;
  };
  readonly timings: {
    readonly total: number;
  };
}

export async function inspectLiveSchema(
  options: InspectLiveSchemaOptions,
  flags: GlobalFlags,
  ui: TerminalUI,
  startTime: number,
  context: InspectLiveSchemaContext,
): Promise<Result<InspectLiveSchemaResult, CliStructuredError>> {
  let config: LoadedCliConfig;
  try {
    config = await loadConfig(options.config);
  } catch (error) {
    if (CliStructuredError.is(error)) {
      return notOk(error);
    }

    return notOk(
      errorUnexpected(error instanceof Error ? error.message : String(error), {
        why: 'Failed to load config',
      }),
    );
  }

  const configPath = options.config
    ? relative(process.cwd(), resolve(options.config))
    : 'prisma-next.config.ts';

  if (!flags.json && !flags.quiet) {
    const details: Array<{ label: string; value: string }> = [
      { label: 'config', value: configPath },
    ];

    if (options.db) {
      details.push({ label: 'database', value: maskConnectionUrl(options.db) });
    } else if (config.db?.connection && typeof config.db.connection === 'string') {
      details.push({ label: 'database', value: maskConnectionUrl(config.db.connection) });
    }

    ui.stderr(
      formatStyledHeader({
        command: context.commandName,
        description: context.description,
        url: context.url,
        details,
        flags,
      }),
    );
  }

  const dbConnection = options.db ?? config.db?.connection;
  if (!dbConnection) {
    return notOk(
      errorDatabaseConnectionRequired({
        why: `Database connection is required for ${context.commandName} (set db.connection in ${configPath}, or pass --db <url>)`,
        commandName: context.commandName,
      }),
    );
  }

  if (!config.driver) {
    return notOk(
      errorDriverRequired({
        why: `Config.driver is required for ${context.commandName}`,
      }),
    );
  }

  const client = createControlClient({
    family: config.family,
    target: config.target,
    adapter: config.adapter,
    driver: config.driver,
    extensionPacks: config.extensionPacks ?? [],
  });
  const onProgress = createProgressAdapter({ ui, flags });

  try {
    const schemaIR = await client.introspect({
      connection: dbConnection,
      onProgress,
    });
    const schema = validatePrintableSqlSchemaIR(schemaIR);
    const schemaView = client.toSchemaView(schema);

    const dbUrl = typeof dbConnection === 'string' ? maskConnectionUrl(dbConnection) : undefined;

    return ok({
      config,
      schema,
      schemaView,
      target: {
        familyId: config.family.familyId,
        id: config.target.targetId,
      },
      meta: {
        configPath,
        ...(dbUrl ? { dbUrl } : {}),
      },
      timings: {
        total: Date.now() - startTime,
      },
    });
  } catch (error) {
    if (CliStructuredError.is(error)) {
      return notOk(error);
    }

    return notOk(
      errorUnexpected(error instanceof Error ? error.message : String(error), {
        why: `Unexpected error during ${context.commandName}: ${error instanceof Error ? error.message : String(error)}`,
      }),
    );
  } finally {
    await client.close();
  }
}
