import { Command } from 'commander';
import { createContractEmitCommand } from './commands/contract-emit';
import { createDbInitCommand } from './commands/db-init';
import { createDbIntrospectCommand } from './commands/db-introspect';
import { createDbSchemaVerifyCommand } from './commands/db-schema-verify';
import { createDbSignCommand } from './commands/db-sign';
import { createDbUpdateCommand } from './commands/db-update';
import { createDbVerifyCommand } from './commands/db-verify';
import { createMigrationApplyCommand } from './commands/migration-apply';
import { createMigrationPlanCommand } from './commands/migration-plan';
import { createMigrationShowCommand } from './commands/migration-show';
import { createMigrationStatusCommand } from './commands/migration-status';
import { createMigrationVerifyCommand } from './commands/migration-verify';
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
    const errorCode = (err as { code?: string }).code;
    const errorMessage = String(err.message ?? '');
    const errorName = err.name ?? '';

    // Unknown command/argument → exit 2 (CLI usage error)
    const isUnknownCommandError =
      errorCode === 'commander.unknownCommand' ||
      errorCode === 'commander.unknownArgument' ||
      (errorName === 'CommanderError' &&
        (errorMessage.includes('unknown command') || errorMessage.includes('unknown argument')));
    if (isUnknownCommandError) {
      const flags = parseGlobalFlags({});
      const match = errorMessage.match(/unknown command ['"]([^'"]+)['"]/);
      const commandName = match ? match[1] : process.argv[3] || process.argv[2] || 'unknown';

      const firstArg = process.argv[2];
      const parentCommand = firstArg
        ? program.commands.find((cmd) => cmd.name() === firstArg)
        : undefined;

      if (parentCommand && commandName !== firstArg) {
        process.stderr.write(`Unknown command: ${commandName}\n\n`);
        const helpText = formatCommandHelp({ command: parentCommand, flags });
        process.stderr.write(`${helpText}\n`);
      } else {
        process.stderr.write(`Unknown command: ${commandName}\n\n`);
        const helpText = formatRootHelp({ program, flags });
        process.stderr.write(`${helpText}\n`);
      }
      process.exit(2);
      return;
    }

    // Help requests → exit 0
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

    // Missing required arguments → exit 2 (CLI usage error)
    const isMissingArgumentError =
      errorCode === 'commander.missingArgument' ||
      errorCode === 'commander.missingMandatoryOptionValue' ||
      (errorName === 'CommanderError' &&
        (errorMessage.includes('missing') || errorMessage.includes('required')));
    if (isMissingArgumentError) {
      process.exit(2);
      return;
    }

    // Unhandled error → exit 1
    process.stderr.write(`Unhandled error: ${err.message}\n`);
    if (err.stack) {
      process.stderr.write(`${err.stack}\n`);
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

// Register migration subcommand
const migrationCommand = new Command('migration');
setCommandDescriptions(
  migrationCommand,
  'On-disk migration management commands',
  'Plan, apply, verify, and scaffold on-disk migration packages. Migrations are\n' +
    'contract-to-contract edges stored as versioned directories under migrations/.',
);
migrationCommand.configureHelp({
  formatHelp: (cmd) => {
    const flags = parseGlobalFlags({});
    return formatCommandHelp({ command: cmd, flags });
  },
  subcommandDescription: () => '',
});

const migrationPlanCommand = createMigrationPlanCommand();
migrationCommand.addCommand(migrationPlanCommand);

const migrationShowCommand = createMigrationShowCommand();
migrationCommand.addCommand(migrationShowCommand);

const migrationStatusCommand = createMigrationStatusCommand();
migrationCommand.addCommand(migrationStatusCommand);

const migrationVerifyCommand = createMigrationVerifyCommand();
migrationCommand.addCommand(migrationVerifyCommand);

const migrationApplyCommand = createMigrationApplyCommand();
migrationCommand.addCommand(migrationApplyCommand);

program.addCommand(migrationCommand);

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
    // Help is decoration → stderr
    process.stderr.write(`${helpText}\n`);
    process.exit(0);
  });

program.addCommand(helpCommand);

// Set help as the default action when no command is provided
program.action(() => {
  const flags = parseGlobalFlags({});
  const helpText = formatRootHelp({ program, flags });
  process.stderr.write(`${helpText}\n`);
  process.exit(0);
});

// Check if a command was invoked with no arguments (just the command name)
// or if an unrecognized command was provided
const args = process.argv.slice(2);
if (args.length > 0) {
  const commandName = args[0];
  // Handle version option explicitly since we suppress default output
  if (commandName === '--version' || commandName === '-V') {
    // Version is data → stdout
    process.stdout.write(`${program.version()}\n`);
    process.exit(0);
  }
  // Skip command check for global options like --help, -h
  const isGlobalOption = commandName === '--help' || commandName === '-h';
  if (!isGlobalOption) {
    // Check if this is a recognized command
    const command = program.commands.find((cmd) => cmd.name() === commandName);

    if (!command) {
      // Unrecognized command → exit 2 (CLI usage error)
      const flags = parseGlobalFlags({});
      process.stderr.write(`Unknown command: ${commandName}\n\n`);
      const helpText = formatRootHelp({ program, flags });
      process.stderr.write(`${helpText}\n`);
      process.exit(2);
    } else if (command.commands.length > 0 && args.length === 1) {
      // Parent command called with no subcommand - show help and exit with 0
      const flags = parseGlobalFlags({});
      const helpText = formatCommandHelp({ command, flags });
      process.stderr.write(`${helpText}\n`);
      process.exit(0);
    }
  }
}

program.parse();
