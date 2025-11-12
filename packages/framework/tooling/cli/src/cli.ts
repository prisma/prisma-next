import { Command } from 'commander';
import { createEmitCommand } from './commands/emit';
import { createContractEmitCommand } from './commands/contract-emit';

const program = new Command();

program.name('prisma-next').description('Prisma Next CLI').version('0.0.1');

// Override exit to handle custom exit codes from error envelopes
program.exitOverride((err) => {
  if (err) {
    // Check if error has exitCode property (set by commands)
    const exitCode = (err as { exitCode?: number }).exitCode ?? 1;
    process.exit(exitCode);
  }
  process.exit(0);
});

// Register contract subcommand
const contractCommand = new Command('contract')
  .description('Contract management commands');

// Add emit subcommand to contract
const contractEmitCommand = createContractEmitCommand();
contractCommand.addCommand(contractEmitCommand);

// Register contract command
program.addCommand(contractCommand);

// Keep legacy emit command as alias
program.addCommand(createEmitCommand());

program.parse();
