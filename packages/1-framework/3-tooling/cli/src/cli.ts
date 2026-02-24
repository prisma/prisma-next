import { Command } from 'commander';
import { createContractEmitCommand } from './commands/contract-emit';
import { createDbInitCommand } from './commands/db-init';
import { createDbIntrospectCommand } from './commands/db-introspect';
import { createDbSchemaVerifyCommand } from './commands/db-schema-verify';
import { createDbSignCommand } from './commands/db-sign';
import { createDbUpdateCommand } from './commands/db-update';
import { createDbVerifyCommand } from './commands/db-verify';
import { setCommandDescriptions } from './utils/command-helpers';
import { parseGlobalFlags } from './utils/global-flags';
import { formatCommandHelp, formatRootHelp } from './utils/output';

const program = new Command();

program.name('prisma-next').description('Prisma Next CLI').version('0.0.1');

// Override version option description to match capitalization style
const versionOption = program.options.find((opt) => opt.flags.includes('--version'));
if (versionOption) {
  versionOption.description = 'Output the version number';
}

program.configureOutput({
  writeErr: () => {
    // Suppress all default error output - we handle errors in exitOverride
  },
  writeOut: () => {
    // Suppress all default output - our custom formatters handle everything
  },
});

// Customize root help output to use our styled format
const rootHelpFormatter = (cmd: Command) => {
  const flags = parseGlobalFlags({});
  return formatRootHelp({ program: cmd, flags });
};

program.configureHelp({
  formatHelp: rootHelpFormatter,
  subcommandDescription: () => '',
});

// Override exit to handle unhandled errors (fail fast cases)
// Commands handle structured errors themselves via process.exit()
program.exitOverride((err) => {
  if (err) {
    // Help requests are not errors - allow Commander to output help and exit normally
    // Commander throws errors with codes like 'commander.help', 'commander.helpDisplayed', or 'outputHelp'
    const errorCode = (err as { code?: string }).code;
    const errorMessage = String(err.message ?? '');
    const errorName = err.name ?? '';

    // Check for unknown command errors first (before other checks)
    // Commander.js uses code 'commander.unknownCommand' or error message contains 'unknown command'
    const isUnknownCommandError =
      errorCode === 'commander.unknownCommand' ||
      errorCode === 'commander.unknownArgument' ||
      (errorName === 'CommanderError' &&
        (errorMessage.includes('unknown command') || errorMessage.includes('unknown argument')));
    if (isUnknownCommandError) {
      const flags = parseGlobalFlags({});
      // Extract the command/subcommand name from the error message
      // Error message format: "unknown command 'command-name'"
      const match = errorMessage.match(/unknown command ['"]([^'"]+)['"]/);
      const commandName = match ? match[1] : process.argv[3] || process.argv[2] || 'unknown';

      // Determine which command context we're in
      // Check if the first argument is a recognized parent command
      const firstArg = process.argv[2];
      const parentCommand = firstArg
        ? program.commands.find((cmd) => cmd.name() === firstArg)
        : undefined;

      if (parentCommand && commandName !== firstArg) {
        // Unrecognized subcommand - show parent command help
        // eslint-disable-next-line no-console
        console.error(`Unknown command: ${commandName}`);
        // eslint-disable-next-line no-console
        console.error('');
        const helpText = formatCommandHelp({ command: parentCommand, flags });
        // eslint-disable-next-line no-console
        console.log(helpText);
      } else {
        // Unrecognized top-level command - show root help
        // eslint-disable-next-line no-console
        console.error(`Unknown command: ${commandName}`);
        // eslint-disable-next-line no-console
        console.error('');
        const helpText = formatRootHelp({ program, flags });
        // eslint-disable-next-line no-console
        console.log(helpText);
      }
      process.exit(1);
      return;
    }
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
    // Missing required arguments/subcommands - show help and exit with 0
    // Commander throws errors with code 'commander.missingArgument' or 'commander.missingMandatoryOptionValue'
    // or when a command with subcommands is called without a subcommand
    const isMissingArgumentError =
      errorCode === 'commander.missingArgument' ||
      errorCode === 'commander.missingMandatoryOptionValue' ||
      (errorName === 'CommanderError' &&
        (errorMessage.includes('missing') || errorMessage.includes('required')));
    if (isMissingArgumentError) {
      // Help was already displayed by Commander.js, just exit with 0
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
const contractCommand = new Command('contract');
setCommandDescriptions(
  contractCommand,
  'Contract management commands',
  'Define and emit your application data contract. The contract describes your schema as a\n' +
    'declarative data structure that can be signed and verified against your database.',
);
contractCommand.configureHelp({
  formatHelp: (cmd) => {
    const flags = parseGlobalFlags({});
    return formatCommandHelp({ command: cmd, flags });
  },
  subcommandDescription: () => '',
});

// Add emit subcommand to contract
const contractEmitCommand = createContractEmitCommand();
contractCommand.addCommand(contractEmitCommand);

// Register contract command
program.addCommand(contractCommand);

// Register db subcommand
const dbCommand = new Command('db');
setCommandDescriptions(
  dbCommand,
  'Database management commands',
  'Verify and sign your database with your contract. Ensure your database schema matches\n' +
    'your contract, and sign it to record the contract hash for future verification.',
);
dbCommand.configureHelp({
  formatHelp: (cmd) => {
    const flags = parseGlobalFlags({});
    return formatCommandHelp({ command: cmd, flags });
  },
  subcommandDescription: () => '',
});

// Add verify subcommand to db
const dbVerifyCommand = createDbVerifyCommand();
dbCommand.addCommand(dbVerifyCommand);

// Add init subcommand to db
const dbInitCommand = createDbInitCommand();
dbCommand.addCommand(dbInitCommand);

// Add update subcommand to db
const dbUpdateCommand = createDbUpdateCommand();
dbCommand.addCommand(dbUpdateCommand);

// Add introspect subcommand to db
const dbIntrospectCommand = createDbIntrospectCommand();
dbCommand.addCommand(dbIntrospectCommand);

// Add schema-verify subcommand to db
const dbSchemaVerifyCommand = createDbSchemaVerifyCommand();
dbCommand.addCommand(dbSchemaVerifyCommand);

// Add sign subcommand to db
const dbSignCommand = createDbSignCommand();
dbCommand.addCommand(dbSignCommand);

// Register db command
program.addCommand(dbCommand);

// Create help command
const helpCommand = new Command('help')
  .description('Show usage instructions')
  .configureHelp({
    formatHelp: (cmd) => {
      const flags = parseGlobalFlags({});
      return formatCommandHelp({ command: cmd, flags });
    },
  })
  .action(() => {
    const flags = parseGlobalFlags({});
    const helpText = formatRootHelp({ program, flags });
    // eslint-disable-next-line no-console
    console.log(helpText);
    process.exit(0);
  });

program.addCommand(helpCommand);

// Set help as the default action when no command is provided
program.action(() => {
  const flags = parseGlobalFlags({});
  const helpText = formatRootHelp({ program, flags });
  // eslint-disable-next-line no-console
  console.log(helpText);
  process.exit(0);
});

// Check if a command was invoked with no arguments (just the command name)
// or if an unrecognized command was provided
const args = process.argv.slice(2);
if (args.length > 0) {
  const commandName = args[0];
  // Handle version option explicitly since we suppress default output
  if (commandName === '--version' || commandName === '-V') {
    // eslint-disable-next-line no-console
    console.log(program.version());
    process.exit(0);
  }
  // Skip command check for global options like --help, -h
  const isGlobalOption = commandName === '--help' || commandName === '-h';
  if (!isGlobalOption) {
    // Check if this is a recognized command
    const command = program.commands.find((cmd) => cmd.name() === commandName);

    if (!command) {
      // Unrecognized command - show error message and usage
      const flags = parseGlobalFlags({});
      // eslint-disable-next-line no-console
      console.error(`Unknown command: ${commandName}`);
      // eslint-disable-next-line no-console
      console.error('');
      const helpText = formatRootHelp({ program, flags });
      // eslint-disable-next-line no-console
      console.log(helpText);
      process.exit(1);
    } else if (command.commands.length > 0 && args.length === 1) {
      // Parent command called with no subcommand - show help and exit with 0
      const flags = parseGlobalFlags({});
      const helpText = formatCommandHelp({ command, flags });
      // eslint-disable-next-line no-console
      console.log(helpText);
      process.exit(0);
    }
  }
}

program.parse();
