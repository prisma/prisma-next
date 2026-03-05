import type { Result } from '@prisma-next/utils/result';
import type { CliStructuredError } from './cli-errors';
import type { GlobalFlags } from './global-flags';
import { formatErrorJson, formatErrorOutput } from './output';
import { TerminalUI } from './terminal-ui';

/**
 * Processes a CLI command result, handling both success and error cases.
 * Formats output appropriately and returns the exit code.
 * Never throws - returns exit code for commands to use with process.exit().
 *
 * Error output:
 * - JSON mode: JSON error to stdout (piped) via ui.output(), human sees nothing on stderr.
 * - Interactive: human-readable error to stderr.
 */
export function handleResult<T>(
  result: Result<T, CliStructuredError>,
  flags: GlobalFlags,
  onSuccess?: (value: T) => void,
): number {
  if (result.ok) {
    if (onSuccess) {
      onSuccess(result.value);
    }
    return 0;
  }

  const ui = new TerminalUI({ color: flags.color, interactive: flags.interactive });

  // Convert to CLI envelope
  const envelope = result.failure.toEnvelope();

  if (flags.json) {
    // JSON error → stdout only
    ui.output(formatErrorJson(envelope));
  } else {
    // Human-readable error → stderr
    ui.error(formatErrorOutput(envelope, flags));
  }

  // Infer exit code from error domain: CLI errors = 2, RTM errors = 1
  const exitCode = result.failure.domain === 'CLI' ? 2 : 1;
  return exitCode;
}
