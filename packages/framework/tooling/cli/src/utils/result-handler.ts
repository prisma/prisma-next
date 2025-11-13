import { mapErrorToCliEnvelope } from './errors';
import type { GlobalFlags } from './global-flags';
import { formatErrorJson, formatErrorOutput } from './output';
import type { Result } from './result';

/**
 * Processes a CLI command result, handling both success and error cases.
 * Formats output appropriately and exits with the correct exit code.
 *
 * @param result - The result from a CLI command
 * @param flags - Global flags for output formatting
 * @param onSuccess - Optional callback for successful results (for custom success output)
 * @returns The exit code that should be used (or undefined if command should continue)
 */
export function handleResult<T>(
  result: Result<T>,
  flags: GlobalFlags,
  onSuccess?: (value: T) => void,
): number | undefined {
  if (result.ok) {
    // Success case
    if (onSuccess) {
      onSuccess(result.value);
    }
    return 0;
  }

  // Error case - map to CLI envelope
  const envelope = mapErrorToCliEnvelope(result.error);

  // Output error based on flags
  if (flags.json === 'object') {
    // JSON error to stderr
    console.error(formatErrorJson(envelope));
  } else {
    // Human-readable error to stderr
    console.error(formatErrorOutput(envelope, flags));
  }

  // Return exit code for Commander.js to use
  return envelope.exitCode ?? 1;
}

/**
 * Processes a CLI command result and throws an error with exit code attached.
 * This is used when you need to throw the error for Commander.js to handle.
 * The error output has already been formatted and displayed.
 *
 * @param result - The result from a CLI command
 * @param flags - Global flags for output formatting
 * @param onSuccess - Optional callback for successful results
 * @throws Error with exitCode property if result is an error
 */
export function handleResultOrThrow<T>(
  result: Result<T>,
  flags: GlobalFlags,
  onSuccess?: (value: T) => void,
): T {
  if (result.ok) {
    if (onSuccess) {
      onSuccess(result.value);
    }
    return result.value;
  }

  // Error case - map to CLI envelope
  const envelope = mapErrorToCliEnvelope(result.error);

  // Output error based on flags
  if (flags.json === 'object') {
    // JSON error to stderr
    console.error(formatErrorJson(envelope));
  } else {
    // Human-readable error to stderr
    console.error(formatErrorOutput(envelope, flags));
  }

  // Throw error with exit code attached for Commander.js
  const cliError = new Error(envelope.summary);
  (cliError as { exitCode?: number }).exitCode = envelope.exitCode ?? 1;
  throw cliError;
}
