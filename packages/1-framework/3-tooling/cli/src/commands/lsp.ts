import { ifDefined } from '@prisma-next/utils/defined';
import { Command } from 'commander';
import {
  addGlobalOptions,
  setCommandDescriptions,
  setCommandExamples,
} from '../utils/command-helpers';
import type { CommonCommandOptions } from '../utils/global-flags';

interface LspCommandOptions extends CommonCommandOptions {
  readonly config?: string;
  readonly stdio?: boolean;
}

export function createLspCommand(): Command {
  const command = new Command('lsp');
  setCommandDescriptions(
    command,
    'Start the Prisma Next language server',
    'Launches a Language Server Protocol server that publishes PSL parse diagnostics\n' +
      'for the schema inputs declared in your config (contract.source.inputs).\n' +
      'Communicates over stdio; intended to be spawned by an\n' +
      'editor, not run interactively. The server keeps running until the editor client\n' +
      'disconnects.',
  );
  setCommandExamples(command, [
    'prisma-next lsp --stdio',
    'prisma-next lsp --stdio --config ./custom-config.ts',
  ]);
  addGlobalOptions(command)
    .option('--stdio', 'Communicate with the editor over stdio (the default and only transport)')
    .option('--config <path>', 'Path to prisma-next.config.ts')
    .action(async (options: LspCommandOptions) => {
      // Lazy import so `vscode-languageserver` stays off every other command's
      // startup path — only `prisma-next lsp` pays its load cost.
      const { startServer } = await import('@prisma-next/language-server');
      startServer({ transport: 'stdio', ...ifDefined('configPath', options.config) });
    });

  return command;
}
