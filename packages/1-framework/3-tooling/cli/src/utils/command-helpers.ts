import type { Command } from 'commander';

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
    // Store long description in a custom property for our formatters to access
    (command as Command & { _longDescription?: string })._longDescription = longDescription;
  }
  return command;
}

/**
 * Gets the long description from a command if it was set via setCommandDescriptions.
 */
export function getLongDescription(command: Command): string | undefined {
  return (command as Command & { _longDescription?: string })._longDescription;
}

/**
 * Shared CLI options interface for migration commands (db init, db update).
 * These are the Commander.js parsed options common to both commands.
 */
export interface MigrationCommandOptions {
  readonly db?: string;
  readonly config?: string;
  readonly plan?: boolean;
  readonly json?: string | boolean;
  readonly quiet?: boolean;
  readonly q?: boolean;
  readonly verbose?: boolean;
  readonly v?: boolean;
  readonly vv?: boolean;
  readonly trace?: boolean;
  readonly timestamps?: boolean;
  readonly color?: boolean;
  readonly 'no-color'?: boolean;
}

/**
 * Masks the password portion of a database connection URL.
 * Handles standard URLs, query-parameter passwords, and libpq-style key=value strings.
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
    // Also mask password in query parameters (e.g., ?password=secret)
    if (parsed.searchParams.has('password')) {
      parsed.searchParams.set('password', '****');
    }
    return parsed.toString();
  } catch {
    // Fallback for libpq-style key=value connection strings (e.g., "host=localhost password=secret")
    return url.replace(/password\s*=\s*\S+/gi, 'password=****');
  }
}
