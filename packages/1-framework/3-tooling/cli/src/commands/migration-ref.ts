import {
  readRefs,
  resolveRef,
  validateRefName,
  writeRefs,
} from '@prisma-next/migration-tools/refs';
import { MigrationToolsError } from '@prisma-next/migration-tools/types';
import { Command } from 'commander';
import { resolve } from 'pathe';
import { loadConfig } from '../config-loader';
import { addGlobalOptions, setCommandDescriptions } from '../utils/command-helpers';
import { formatCommandHelp } from '../utils/formatters/help';
import { parseGlobalFlags } from '../utils/global-flags';

function resolveRefsPath(configPath?: string, config?: { migrations?: { dir?: string } }): string {
  const base = configPath ? resolve(configPath, '..') : process.cwd();
  return resolve(base, config?.migrations?.dir ?? 'migrations', 'refs.json');
}

function createRefSetCommand(): Command {
  const command = new Command('set');
  setCommandDescriptions(
    command,
    'Set a ref to a contract hash',
    'Sets a named ref to point to a contract hash in migrations/refs.json.',
  );
  addGlobalOptions(command)
    .argument('<name>', 'Ref name (e.g., staging, production)')
    .argument('<hash>', 'Contract hash to point to')
    .option('--config <path>', 'Path to prisma-next.config.ts')
    .action(
      async (
        name: string,
        hash: string,
        options: { config?: string; json?: string | boolean; quiet?: boolean },
      ) => {
        const flags = parseGlobalFlags(options);

        if (!validateRefName(name)) {
          console.error(
            `Invalid ref name "${name}". Names must be lowercase alphanumeric with hyphens or forward slashes.`,
          );
          process.exit(1);
        }

        const config = await loadConfig(options.config);
        const refsPath = resolveRefsPath(options.config, config);

        try {
          const refs = await readRefs(refsPath);
          const updated = { ...refs, [name]: hash };
          await writeRefs(refsPath, updated);

          if (flags.json) {
            console.log(JSON.stringify({ ok: true, ref: name, hash }));
          } else if (!flags.quiet) {
            console.log(`Set ref "${name}" → ${hash}`);
          }
        } catch (error) {
          if (MigrationToolsError.is(error)) {
            console.error(`Error: ${error.message}\n${error.fix}`);
          } else {
            console.error(error instanceof Error ? error.message : String(error));
          }
          process.exit(1);
        }
      },
    );
  return command;
}

function createRefGetCommand(): Command {
  const command = new Command('get');
  setCommandDescriptions(
    command,
    'Get the hash for a ref',
    'Reads a named ref from migrations/refs.json and prints its contract hash.',
  );
  addGlobalOptions(command)
    .argument('<name>', 'Ref name to look up')
    .option('--config <path>', 'Path to prisma-next.config.ts')
    .action(
      async (
        name: string,
        options: { config?: string; json?: string | boolean; quiet?: boolean },
      ) => {
        const flags = parseGlobalFlags(options);
        const config = await loadConfig(options.config);
        const refsPath = resolveRefsPath(options.config, config);

        try {
          const refs = await readRefs(refsPath);
          const hash = resolveRef(refs, name);

          if (flags.json) {
            console.log(JSON.stringify({ ok: true, ref: name, hash }));
          } else {
            console.log(hash);
          }
        } catch (error) {
          if (MigrationToolsError.is(error)) {
            console.error(`Error: ${error.message}\n${error.fix}`);
          } else {
            console.error(error instanceof Error ? error.message : String(error));
          }
          process.exit(1);
        }
      },
    );
  return command;
}

function createRefDeleteCommand(): Command {
  const command = new Command('delete');
  setCommandDescriptions(command, 'Delete a ref', 'Removes a named ref from migrations/refs.json.');
  addGlobalOptions(command)
    .argument('<name>', 'Ref name to delete')
    .option('--config <path>', 'Path to prisma-next.config.ts')
    .action(
      async (
        name: string,
        options: { config?: string; json?: string | boolean; quiet?: boolean },
      ) => {
        const flags = parseGlobalFlags(options);
        const config = await loadConfig(options.config);
        const refsPath = resolveRefsPath(options.config, config);

        try {
          const refs = await readRefs(refsPath);
          if (!Object.hasOwn(refs, name)) {
            console.error(`Ref "${name}" does not exist.`);
            process.exit(1);
          }
          const { [name]: _, ...remaining } = refs;
          await writeRefs(refsPath, remaining);

          if (flags.json) {
            console.log(JSON.stringify({ ok: true, ref: name, deleted: true }));
          } else if (!flags.quiet) {
            console.log(`Deleted ref "${name}"`);
          }
        } catch (error) {
          if (MigrationToolsError.is(error)) {
            console.error(`Error: ${error.message}\n${error.fix}`);
          } else {
            console.error(error instanceof Error ? error.message : String(error));
          }
          process.exit(1);
        }
      },
    );
  return command;
}

function createRefListCommand(): Command {
  const command = new Command('list');
  setCommandDescriptions(
    command,
    'List all refs',
    'Lists all named refs from migrations/refs.json.',
  );
  addGlobalOptions(command)
    .option('--config <path>', 'Path to prisma-next.config.ts')
    .action(async (options: { config?: string; json?: string | boolean; quiet?: boolean }) => {
      const flags = parseGlobalFlags(options);
      const config = await loadConfig(options.config);
      const refsPath = resolveRefsPath(options.config, config);

      try {
        const refs = await readRefs(refsPath);
        const entries = Object.entries(refs);

        if (flags.json) {
          console.log(JSON.stringify({ ok: true, refs }));
        } else if (!flags.quiet) {
          if (entries.length === 0) {
            console.log('No refs defined');
          } else {
            for (const [name, hash] of entries) {
              console.log(`${name} → ${hash}`);
            }
          }
        }
      } catch (error) {
        if (MigrationToolsError.is(error)) {
          console.error(`Error: ${error.message}\n${error.fix}`);
        } else {
          console.error(error instanceof Error ? error.message : String(error));
        }
        process.exit(1);
      }
    });
  return command;
}

export function createMigrationRefCommand(): Command {
  const command = new Command('ref');
  setCommandDescriptions(
    command,
    'Manage migration refs',
    'Manage named refs in migrations/refs.json. Refs map logical environment\n' +
      'names (e.g., staging, production) to contract hashes.',
  );
  addGlobalOptions(command).configureHelp({
    formatHelp: (cmd) => formatCommandHelp({ command: cmd, flags: parseGlobalFlags({}) }),
    subcommandDescription: () => '',
  });
  command.addCommand(createRefSetCommand());
  command.addCommand(createRefGetCommand());
  command.addCommand(createRefDeleteCommand());
  command.addCommand(createRefListCommand());
  return command;
}
