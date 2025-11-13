import { Command } from 'commander';
import { createContractEmitCommand } from './commands/contract-emit';
import { createDbVerifyCommand } from './commands/db-verify';
import { createEmitCommand } from './commands/emit';
import { parseGlobalFlags } from './utils/global-flags';
import { formatCommandHelp, formatRootHelp } from './utils/output';

const program = new Command();

program.name('prisma-next').description('Prisma Next CLI').version('0.0.1');

// Suppress Commander.js default error output since commands handle errors themselves
program.configureOutput({
  writeErr: () => {
    // Suppress default error output - commands handle error formatting
  },
});

// Customize root help output to use our styled format
const rootHelpFormatter = (cmd: Command) => {
  const flags = parseGlobalFlags({});
  return formatRootHelp({ program: cmd, flags });
};

program.configureHelp({ formatHelp: rootHelpFormatter });

// Override exit to handle unhandled errors (fail fast cases)
// Commands handle structured errors themselves via process.exit()
program.exitOverride((err) => {
  if (err) {
    // Help requests are not errors - allow Commander to output help and exit normally
    // Commander throws errors with codes like 'commander.help', 'commander.helpDisplayed', or 'outputHelp'
    // The error message may be '(outputHelp)' or the code may be 'outputHelp'
    const errorCode = (err as { code?: string }).code;
    const errorMessage = String(err.message ?? '');
    const errorName = err.name ?? '';
    const isHelpError =
      errorCode === 'commander.help' ||
      errorCode === 'commander.helpDisplayed' ||
      errorCode === 'outputHelp' ||
      errorMessage === '(outputHelp)' ||
      errorMessage.includes('outputHelp') ||
      (errorName === 'CommanderError' && errorMessage.includes('outputHelp'));
    if (isHelpError) {
      process.exit(0);
      return;
    }
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
const contractCommand = new Command('contract')
  .description('Contract management commands')
  .configureHelp({
    formatHelp: (cmd) => {
      const flags = parseGlobalFlags({});
      return formatCommandHelp({ command: cmd, flags });
    },
  });

// Add emit subcommand to contract
const contractEmitCommand = createContractEmitCommand();
contractCommand.addCommand(contractEmitCommand);

// Register contract command
program.addCommand(contractCommand);

// Register db subcommand
const dbCommand = new Command('db').description('Database management commands').configureHelp({
  formatHelp: (cmd) => {
    const flags = parseGlobalFlags({});
    return formatCommandHelp({ command: cmd, flags });
  },
});

// Add verify subcommand to db
const dbVerifyCommand = createDbVerifyCommand();
dbCommand.addCommand(dbVerifyCommand);

// Register db command
program.addCommand(dbCommand);

// Keep legacy emit command as alias
program.addCommand(createEmitCommand());

program.parse();
