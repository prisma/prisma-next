import type { GlobalFlags } from './global-flags';
import { formatErrorJson, formatErrorOutput } from './output';
import type { Result } from './result';

/**
 * Processes a CLI command result, handling both success and error cases.
 * Formats output appropriately and returns the exit code.
 * Never throws - returns exit code for commands to use with process.exit().
 *
 * @param result - The result from a CLI command
 * @param flags - Global flags for output formatting
 * @param onSuccess - Optional callback for successful results (for custom success output)
 * @returns The exit code that should be used (0 for success, non-zero for errors)
 */
export function handleResult<T>(
  result: Result<T>,
  flags: GlobalFlags,
  onSuccess?: (value: T) => void,
): number {
  if (result.ok) {
    // Success case
    if (onSuccess) {
      onSuccess(result.value);
    }
    return 0;
  }

  // Error case - convert to CLI envelope
  const envelope = result.error.toEnvelope();

  // Output error based on flags
  if (flags.json) {
    // JSON error to stderr
    console.error(formatErrorJson(envelope));
  } else {
    // Human-readable error to stderr
    console.error(formatErrorOutput(envelope, flags));
  }

  // Infer exit code from error domain: CLI errors = 2, RTM errors = 1
  const exitCode = result.error.domain === 'CLI' ? 2 : 1;
  return exitCode;
}
