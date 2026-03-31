import type { RefEntry } from '@prisma-next/migration-tools/refs';
import {
  deleteRef,
  readRef,
  readRefs,
  validateRefName,
  validateRefValue,
  writeRef,
} from '@prisma-next/migration-tools/refs';
import { MigrationToolsError } from '@prisma-next/migration-tools/types';
import { notOk, ok, type Result } from '@prisma-next/utils/result';
import { Command } from 'commander';
import { resolve } from 'pathe';
import { loadConfig } from '../config-loader';
import { CliStructuredError, errorRuntime, errorUnexpected } from '../utils/cli-errors';
import { addGlobalOptions, setCommandDescriptions } from '../utils/command-helpers';
import { formatCommandHelp } from '../utils/formatters/help';
import { parseGlobalFlags } from '../utils/global-flags';
import { handleResult } from '../utils/result-handler';
import { TerminalUI } from '../utils/terminal-ui';

interface RefSetResult {
  readonly ok: true;
  readonly ref: string;
  readonly hash: string;
  readonly invariants: readonly string[];
}

interface RefGetResult {
  readonly ok: true;
  readonly ref: string;
  readonly hash: string;
  readonly invariants: readonly string[];
}

interface RefDeleteResult {
  readonly ok: true;
  readonly ref: string;
  readonly deleted: true;
}

interface RefListResult {
  readonly ok: true;
  readonly refs: Record<string, RefEntry>;
}

function resolveRefsDir(configPath?: string, config?: { migrations?: { dir?: string } }): string {
  const base = configPath ? resolve(configPath, '..') : process.cwd();
  return resolve(base, config?.migrations?.dir ?? 'migrations', 'refs');
}

function mapError(error: unknown): CliStructuredError {
  if (MigrationToolsError.is(error)) {
    return errorRuntime(error.message, {
      why: error.why,
      fix: error.fix,
      meta: { code: error.code },
    });
  }
  return errorUnexpected(error instanceof Error ? error.message : String(error));
}

function cliErrorInvalidRefName(name: string): CliStructuredError {
  return errorRuntime(`Invalid ref name "${name}"`, {
    why: `Ref name "${name}" does not match the required format`,
    fix: 'Ref names must be lowercase alphanumeric with hyphens or forward slashes, no `.` or `..` segments',
  });
}

function cliErrorInvalidRefValue(hash: string): CliStructuredError {
  return errorRuntime(`Invalid contract hash "${hash}"`, {
    why: `"${hash}" is not a valid contract hash`,
    fix: 'Contract hashes must match the format "sha256:<64 hex chars>". Copy the hash from `prisma-next contract emit` or `migration status --json`.',
  });
}

async function executeRefSetCommand(
  name: string,
  hash: string,
  options: { config?: string },
): Promise<Result<RefSetResult, CliStructuredError>> {
  if (!validateRefName(name)) {
    return notOk(cliErrorInvalidRefName(name));
  }
  if (!validateRefValue(hash)) {
    return notOk(cliErrorInvalidRefValue(hash));
  }

  try {
    const config = await loadConfig(options.config);
    const refsDir = resolveRefsDir(options.config, config);
    const entry: RefEntry = { hash, invariants: [] };
    await writeRef(refsDir, name, entry);
    return ok({ ok: true as const, ref: name, hash, invariants: [] });
  } catch (error) {
    if (error instanceof CliStructuredError) return notOk(error);
    return notOk(mapError(error));
  }
}

async function executeRefGetCommand(
  name: string,
  options: { config?: string },
): Promise<Result<RefGetResult, CliStructuredError>> {
  try {
    const config = await loadConfig(options.config);
    const refsDir = resolveRefsDir(options.config, config);
    const entry = await readRef(refsDir, name);
    return ok({ ok: true as const, ref: name, hash: entry.hash, invariants: entry.invariants });
  } catch (error) {
    if (error instanceof CliStructuredError) return notOk(error);
    return notOk(mapError(error));
  }
}

async function executeRefDeleteCommand(
  name: string,
  options: { config?: string },
): Promise<Result<RefDeleteResult, CliStructuredError>> {
  try {
    const config = await loadConfig(options.config);
    const refsDir = resolveRefsDir(options.config, config);
    await deleteRef(refsDir, name);
    return ok({ ok: true as const, ref: name, deleted: true as const });
  } catch (error) {
    if (error instanceof CliStructuredError) return notOk(error);
    return notOk(mapError(error));
  }
}

async function executeRefListCommand(options: {
  config?: string;
}): Promise<Result<RefListResult, CliStructuredError>> {
  try {
    const config = await loadConfig(options.config);
    const refsDir = resolveRefsDir(options.config, config);
    const refs = await readRefs(refsDir);
    return ok({ ok: true as const, refs });
  } catch (error) {
    if (error instanceof CliStructuredError) return notOk(error);
    return notOk(mapError(error));
  }
}

function createRefSetCommand(): Command {
  const command = new Command('set');
  setCommandDescriptions(
    command,
    'Set a ref to a contract hash',
    'Sets a named ref to point to a contract hash in migrations/refs/.',
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
        const ui = new TerminalUI({ color: flags.color, interactive: flags.interactive });
        const result = await executeRefSetCommand(name, hash, options);
        const exitCode = handleResult(result, flags, ui, (value) => {
          if (flags.json) {
            ui.output(JSON.stringify(value));
          } else if (!flags.quiet) {
            ui.output(`Set ref "${value.ref}" → ${value.hash}`);
          }
        });
        process.exit(exitCode);
      },
    );
  return command;
}

function createRefGetCommand(): Command {
  const command = new Command('get');
  setCommandDescriptions(
    command,
    'Get the hash for a ref',
    'Reads a named ref from migrations/refs/ and prints its contract hash.',
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
        const ui = new TerminalUI({ color: flags.color, interactive: flags.interactive });
        const result = await executeRefGetCommand(name, options);
        const exitCode = handleResult(result, flags, ui, (value) => {
          if (flags.json) {
            ui.output(JSON.stringify(value));
          } else {
            ui.output(value.hash);
          }
        });
        process.exit(exitCode);
      },
    );
  return command;
}

function createRefDeleteCommand(): Command {
  const command = new Command('delete');
  setCommandDescriptions(command, 'Delete a ref', 'Removes a named ref from migrations/refs/.');
  addGlobalOptions(command)
    .argument('<name>', 'Ref name to delete')
    .option('--config <path>', 'Path to prisma-next.config.ts')
    .action(
      async (
        name: string,
        options: { config?: string; json?: string | boolean; quiet?: boolean },
      ) => {
        const flags = parseGlobalFlags(options);
        const ui = new TerminalUI({ color: flags.color, interactive: flags.interactive });
        const result = await executeRefDeleteCommand(name, options);
        const exitCode = handleResult(result, flags, ui, (value) => {
          if (flags.json) {
            ui.output(JSON.stringify(value));
          } else if (!flags.quiet) {
            ui.output(`Deleted ref "${value.ref}"`);
          }
        });
        process.exit(exitCode);
      },
    );
  return command;
}

function createRefListCommand(): Command {
  const command = new Command('list');
  setCommandDescriptions(command, 'List all refs', 'Lists all named refs from migrations/refs/.');
  addGlobalOptions(command)
    .option('--config <path>', 'Path to prisma-next.config.ts')
    .action(async (options: { config?: string; json?: string | boolean; quiet?: boolean }) => {
      const flags = parseGlobalFlags(options);
      const ui = new TerminalUI({ color: flags.color, interactive: flags.interactive });
      const result = await executeRefListCommand(options);
      const exitCode = handleResult(result, flags, ui, (value) => {
        if (flags.json) {
          ui.output(JSON.stringify(value));
        } else if (!flags.quiet) {
          const entries = Object.entries(value.refs);
          if (entries.length === 0) {
            ui.output('No refs defined');
          } else {
            for (const [refName, entry] of entries) {
              const invariantsSuffix =
                entry.invariants.length > 0 ? ` [invariants: ${entry.invariants.join(', ')}]` : '';
              ui.output(`${refName} → ${entry.hash}${invariantsSuffix}`);
            }
          }
        }
      });
      process.exit(exitCode);
    });
  return command;
}

export {
  executeRefSetCommand,
  executeRefGetCommand,
  executeRefDeleteCommand,
  executeRefListCommand,
  cliErrorInvalidRefName,
  cliErrorInvalidRefValue,
};

export function createMigrationRefCommand(): Command {
  const command = new Command('ref');
  setCommandDescriptions(
    command,
    'Manage migration refs',
    'Manage named refs in migrations/refs/. Refs map logical environment\n' +
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
