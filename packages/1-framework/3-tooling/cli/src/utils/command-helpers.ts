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
