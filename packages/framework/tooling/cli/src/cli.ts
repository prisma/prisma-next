import { Command } from 'commander';
import { createContractEmitCommand } from './commands/contract-emit';
import { createDbVerifyCommand } from './commands/db-verify';
import { createEmitCommand } from './commands/emit';

const program = new Command();

program.name('prisma-next').description('Prisma Next CLI').version('0.0.1');

// Suppress Commander.js default error output since commands handle errors themselves
program.configureOutput({
  writeErr: () => {
    // Suppress default error output - commands handle error formatting
  },
});

// Override exit to handle unhandled errors (fail fast cases)
// Commands handle structured errors themselves via process.exit()
program.exitOverride((err) => {
  if (err) {
    // Unhandled error - fail fast with exit code 1
    // eslint-disable-next-line no-console
    console.error(`Unhandled error: ${err.message}`);
    if (err.stack) {
      // eslint-disable-next-line no-console
      console.error(err.stack);
    }
    process.exit(1);
  }
  process.exit(0);
});

// Register contract subcommand
const contractCommand = new Command('contract').description('Contract management commands');

// Add emit subcommand to contract
const contractEmitCommand = createContractEmitCommand();
contractCommand.addCommand(contractEmitCommand);

// Register contract command
program.addCommand(contractCommand);

// Register db subcommand
const dbCommand = new Command('db').description('Database management commands');

// Add verify subcommand to db
const dbVerifyCommand = createDbVerifyCommand();
dbCommand.addCommand(dbVerifyCommand);

// Register db command
program.addCommand(dbCommand);

// Keep legacy emit command as alias
program.addCommand(createEmitCommand());

program.parse();
