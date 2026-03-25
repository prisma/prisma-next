import type { IntrospectSchemaResult } from '@prisma-next/core-control-plane/types';
import { Command } from 'commander';
import {
  addGlobalOptions,
  setCommandDescriptions,
  setCommandExamples,
} from '../utils/command-helpers';
import { formatIntrospectJson, formatIntrospectOutput } from '../utils/formatters/verify';
import { parseGlobalFlags } from '../utils/global-flags';
import { handleResult } from '../utils/result-handler';
import { TerminalUI } from '../utils/terminal-ui';
import {
  type InspectLiveSchemaOptions,
  type InspectLiveSchemaResult,
  inspectLiveSchema,
} from './inspect-live-schema';

function toIntrospectSchemaResult(
  result: InspectLiveSchemaResult,
): IntrospectSchemaResult<unknown> {
  return {
    ok: true,
    summary: 'Schema read successfully',
    target: result.target,
    schema: result.schema,
    ...(result.meta ? { meta: result.meta } : {}),
    timings: result.timings,
  };
}

export function createDbSchemaCommand(): Command {
  const command = new Command('schema');
  setCommandDescriptions(
    command,
    'Inspect the live database schema',
    'Reads the live database schema and prints it as a tree by default or as JSON with\n' +
      '--json. This command is always read-only and never writes files. To save machine-\n' +
      'readable output, use shell redirection, for example `prisma-next db schema --json > schema.json`.',
  );
  setCommandExamples(command, [
    'prisma-next db schema --db $DATABASE_URL',
    'prisma-next db schema --db $DATABASE_URL --json',
    'prisma-next db schema --db $DATABASE_URL --json > schema.json',
  ]);
  addGlobalOptions(command)
    .option('--db <url>', 'Database connection string')
    .option('--config <path>', 'Path to prisma-next.config.ts')
    .action(async (options: InspectLiveSchemaOptions) => {
      const flags = parseGlobalFlags(options);
      const ui = new TerminalUI({ color: flags.color, interactive: flags.interactive });
      const startTime = Date.now();

      const result = await inspectLiveSchema(options, flags, ui, startTime, {
        commandName: 'db schema',
        description: 'Inspect the live database schema',
        url: 'https://pris.ly/db-schema',
      });

      const exitCode = handleResult(result, flags, ui, (value) => {
        const introspectResult = toIntrospectSchemaResult(value);

        if (flags.json) {
          ui.output(formatIntrospectJson(introspectResult));
          return;
        }

        const output = formatIntrospectOutput(introspectResult, value.schemaView, flags);
        if (output) {
          ui.log(output);
        }
      });

      process.exit(exitCode);
    });

  return command;
}
