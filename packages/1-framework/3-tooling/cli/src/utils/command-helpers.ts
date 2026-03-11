import type { Command } from 'commander';
import { resolve } from 'pathe';
import { formatCommandHelp } from './formatters/help';
import type { CommonCommandOptions } from './global-flags';
import { parseGlobalFlags } from './global-flags';

const longDescriptions = new WeakMap<Command, string>();
const commandExamples = new WeakMap<Command, readonly string[]>();

/**
 * Sets both short and long descriptions for a command.
 * The short description is used in command trees and headers.
 * The long description is shown at the bottom of help output.
 */
export function setCommandDescriptions(
  command: Command,
  shortDescription: string,
  longDescription?: string,
): Command {
  command.description(shortDescription);
  if (longDescription) {
    longDescriptions.set(command, longDescription);
  }
  return command;
}

/**
 * Sets copy-pastable examples for a command, shown in help text.
 */
export function setCommandExamples(command: Command, examples: readonly string[]): Command {
  commandExamples.set(command, examples);
  return command;
}

/**
 * Gets the long description from a command if it was set via setCommandDescriptions.
 */
export function getLongDescription(command: Command): string | undefined {
  return longDescriptions.get(command);
}

/**
 * Gets examples from a command if set via setCommandExamples.
 */
export function getCommandExamples(command: Command): readonly string[] | undefined {
  return commandExamples.get(command);
}

/**
 * Shared CLI options interface for migration commands (db init, db update).
 * These are the Commander.js parsed options common to both commands.
 */
export interface MigrationCommandOptions extends CommonCommandOptions {
  readonly db?: string;
  readonly config?: string;
  readonly dryRun?: boolean;
}

/**
 * Resolves the absolute path to contract.json from the config.
 * Centralises the fallback logic shared by every command that reads the contract.
 */
export function resolveContractPath(config: { contract?: { output?: string } }): string {
  return config.contract?.output
    ? resolve(config.contract.output)
    : resolve('src/prisma/contract.json');
}

/**
 * Masks credentials in a database connection URL.
 * Handles standard URLs (username + password + query params) and libpq-style key=value strings.
 */
export function maskConnectionUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.username) {
      parsed.username = '****';
    }
    if (parsed.password) {
      parsed.password = '****';
    }
    // Also mask password in query parameters (e.g., ?password=secret, ?sslpassword=secret)
    for (const key of [...parsed.searchParams.keys()]) {
      if (/password/i.test(key)) {
        parsed.searchParams.set(key, '****');
      }
    }
    return parsed.toString();
  } catch {
    // Fallback for libpq-style key=value connection strings (e.g., "host=localhost password=secret user=admin")
    return url
      .replace(/password\s*=\s*\S+/gi, 'password=****')
      .replace(/user\s*=\s*\S+/gi, 'user=****');
  }
}

/**
 * Strips raw connection URL fragments from an error message to prevent credential leakage.
 * Call this before surfacing driver errors to the user.
 */
export function sanitizeErrorMessage(message: string, connectionUrl?: string): string {
  if (!connectionUrl) {
    return message;
  }
  try {
    const parsed = new URL(connectionUrl);
    // Replace the full URL (with and without trailing slash)
    let sanitized = message;
    sanitized = sanitized.replaceAll(connectionUrl, maskConnectionUrl(connectionUrl));
    // Also replace the password and username individually if they appear
    if (parsed.password) {
      sanitized = sanitized.replaceAll(parsed.password, '****');
    }
    if (parsed.username) {
      sanitized = sanitized.replaceAll(parsed.username, '****');
    }
    return sanitized;
  } catch {
    // For libpq-style strings, mask password and user values in the message
    return message
      .replace(/password\s*=\s*\S+/gi, 'password=****')
      .replace(/user\s*=\s*\S+/gi, 'user=****');
  }
}

/**
 * Registers the global CLI options shared by every command:
 * --json, -q/--quiet, -v/--verbose, --trace, --color, --no-color,
 * --interactive, --no-interactive, -y/--yes.
 *
 * Also sets up the styled help formatter.
 */
export function addGlobalOptions(command: Command): Command {
  return command
    .configureHelp({
      formatHelp: (cmd) => {
        const flags = parseGlobalFlags({});
        return formatCommandHelp({ command: cmd, flags });
      },
    })
    .option('--json', 'Output as JSON')
    .option('-q, --quiet', 'Quiet mode: errors only')
    .option('-v, --verbose', 'Verbose output: debug info, timings')
    .option('--trace', 'Trace output: deep internals, stack traces')
    .option('--color', 'Force color output')
    .option('--no-color', 'Disable color output')
    .option('--interactive', 'Force interactive mode')
    .option('--no-interactive', 'Disable interactive prompts')
    .option('-y, --yes', 'Auto-accept prompts');
}
