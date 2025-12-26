import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import {
  errorDatabaseUrlRequired,
  errorDriverRequired,
  errorRuntime,
  errorUnexpected,
} from '@prisma-next/core-control-plane/errors';
import type { CoreSchemaView } from '@prisma-next/core-control-plane/schema-view';
import type { FamilyInstance, IntrospectSchemaResult } from '@prisma-next/core-control-plane/types';
import { Command } from 'commander';
import { loadConfig } from '../config-loader';
import { setCommandDescriptions } from '../utils/command-helpers';
import { parseGlobalFlags } from '../utils/global-flags';
import {
  formatCommandHelp,
  formatIntrospectJson,
  formatIntrospectOutput,
  formatStyledHeader,
} from '../utils/output';
import { performAction } from '../utils/result';
import { handleResult } from '../utils/result-handler';
import { withSpinner } from '../utils/spinner';

interface DbIntrospectOptions {
  readonly db?: string;
  readonly config?: string;
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

export function createDbIntrospectCommand(): Command {
  const command = new Command('introspect');
  setCommandDescriptions(
    command,
    'Inspect the database schema',
    'Reads the live database schema and displays it as a tree structure. This command\n' +
      'does not check the schema against your contract - it only shows what exists in\n' +
      'the database. Use `db verify` or `db schema-verify` to compare against your contract.',
  );
  command
    .configureHelp({
      formatHelp: (cmd) => {
        const flags = parseGlobalFlags({});
        return formatCommandHelp({ command: cmd, flags });
      },
    })
    .option('--db <url>', 'Database connection string')
    .option('--config <path>', 'Path to prisma-next.config.ts')
    .option('--json [format]', 'Output as JSON (object or ndjson)', false)
    .option('-q, --quiet', 'Quiet mode: errors only')
    .option('-v, --verbose', 'Verbose output: debug info, timings')
    .option('-vv, --trace', 'Trace output: deep internals, stack traces')
    .option('--timestamps', 'Add timestamps to output')
    .option('--color', 'Force color output')
    .option('--no-color', 'Disable color output')
    .action(async (options: DbIntrospectOptions) => {
      const flags = parseGlobalFlags(options);

      const result = await performAction(async () => {
        const startTime = Date.now();

        // Load config (file I/O)
        const config = await loadConfig(options.config);
        // Normalize config path for display (match contract path format - no ./ prefix)
        const configPath = options.config
          ? relative(process.cwd(), resolve(options.config))
          : 'prisma-next.config.ts';

        // Optionally load contract if contract config exists
        let contractIR: unknown | undefined;
        if (config.contract?.output) {
          const contractPath = resolve(config.contract.output);
          try {
            const contractJsonContent = await readFile(contractPath, 'utf-8');
            const contractJson = JSON.parse(contractJsonContent) as Record<string, unknown>;
            // Validate contract using family instance (will be created later)
            // For now, we'll pass the raw JSON and let the family instance validate it
            contractIR = contractJson;
          } catch (error) {
            // Contract file is optional for introspection - don't fail if it doesn't exist
            if (error instanceof Error && (error as { code?: string }).code !== 'ENOENT') {
              throw errorUnexpected(error.message, {
                why: `Failed to read contract file: ${error.message}`,
              });
            }
          }
        }

        // Output header (only for human-readable output)
        if (flags.json !== 'object' && !flags.quiet) {
          const details: Array<{ label: string; value: string }> = [
            { label: 'config', value: configPath },
          ];
          if (options.db) {
            // Mask password in URL for security
            const maskedUrl = options.db.replace(/:([^:@]+)@/, ':****@');
            details.push({ label: 'database', value: maskedUrl });
          } else if (config.db?.url) {
            // Mask password in URL for security
            const maskedUrl = config.db.url.replace(/:([^:@]+)@/, ':****@');
            details.push({ label: 'database', value: maskedUrl });
          }
          const header = formatStyledHeader({
            command: 'db introspect',
            description: 'Inspect the database schema',
            url: 'https://pris.ly/db-introspect',
            details,
            flags,
          });
          console.log(header);
        }

        // Resolve database URL
        const dbUrl = options.db ?? config.db?.url;
        if (!dbUrl) {
          throw errorDatabaseUrlRequired();
        }

        // Check for driver
        if (!config.driver) {
          throw errorDriverRequired();
        }

        // Store driver descriptor after null check
        const driverDescriptor = config.driver;

        // Create driver
        const driver = await withSpinner(() => driverDescriptor.create(dbUrl), {
          message: 'Connecting to database...',
          flags,
        });

        try {
          // Create family instance
          const familyInstance = config.family.create({
            target: config.target,
            adapter: config.adapter,
            driver: driverDescriptor,
            extensions: config.extensions ?? [],
          });
          const typedFamilyInstance = familyInstance as FamilyInstance<string>;

          // Validate contract IR if we loaded it
          if (contractIR) {
            contractIR = typedFamilyInstance.validateContractIR(contractIR);
          }

          // Call family instance introspect method
          let schemaIR: unknown;
          try {
            schemaIR = await withSpinner(
              () =>
                typedFamilyInstance.introspect({
                  driver,
                  contractIR,
                }),
              {
                message: 'Introspecting database schema...',
                flags,
              },
            );
          } catch (error) {
            // Wrap errors from introspect() in structured error
            throw errorRuntime(error instanceof Error ? error.message : String(error), {
              why: `Failed to introspect database: ${error instanceof Error ? error.message : String(error)}`,
            });
          }

          // Optionally call toSchemaView if available
          let schemaView: CoreSchemaView | undefined;
          if (typedFamilyInstance.toSchemaView) {
            try {
              schemaView = typedFamilyInstance.toSchemaView(schemaIR);
            } catch (error) {
              // Schema view projection is optional - log but don't fail
              if (flags.verbose) {
                console.error(
                  `Warning: Failed to project schema to view: ${error instanceof Error ? error.message : String(error)}`,
                );
              }
            }
          }

          const totalTime = Date.now() - startTime;

          // Add blank line after all async operations if spinners were shown
          if (!flags.quiet && flags.json !== 'object' && process.stdout.isTTY) {
            console.log('');
          }

          // Build result envelope
          const introspectResult: IntrospectSchemaResult<unknown> = {
            ok: true,
            summary: 'Schema introspected successfully',
            target: {
              familyId: config.family.familyId,
              id: config.target.targetId,
            },
            schema: schemaIR,
            ...(configPath || options.db || config.db?.url
              ? {
                  meta: {
                    ...(configPath ? { configPath } : {}),
                    ...(options.db || config.db?.url
                      ? {
                          dbUrl: (options.db ?? config.db?.url ?? '').replace(
                            /:([^:@]+)@/,
                            ':****@',
                          ),
                        }
                      : {}),
                  },
                }
              : {}),
            timings: {
              total: totalTime,
            },
          };

          return { introspectResult, schemaView };
        } finally {
          // Ensure driver connection is closed
          await driver.close();
        }
      });

      // Handle result - formats output and returns exit code
      const exitCode = handleResult(result, flags, (value) => {
        const { introspectResult, schemaView } = value;
        // Output based on flags
        if (flags.json === 'object') {
          // JSON output to stdout
          console.log(formatIntrospectJson(introspectResult));
        } else {
          // Human-readable output to stdout
          const output = formatIntrospectOutput(introspectResult, schemaView, flags);
          if (output) {
            console.log(output);
          }
        }
      });
      process.exit(exitCode);
    });

  return command;
}
