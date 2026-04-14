import { Command } from 'commander';
import { setCommandDescriptions, setCommandExamples } from '../../utils/command-helpers';

export function createInitCommand(): Command {
  const command = new Command('init');
  setCommandDescriptions(
    command,
    'Initialize a new Prisma Next project',
    'Scaffolds config, schema, and runtime files, installs dependencies,\n' +
      'and emits the contract. Gets you from zero to typed queries in one step.',
  );
  setCommandExamples(command, ['prisma-next init', 'prisma-next init --no-install']);
  command
    .option('--no-install', 'Skip dependency installation and contract emission')
    .action(async (options: { readonly install?: boolean }) => {
      const { runInit } = await import('./init');
      await runInit(process.cwd(), { noInstall: !options.install });
    });

  return command;
}
