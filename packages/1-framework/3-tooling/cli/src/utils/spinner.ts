import ora from 'ora';
import type { GlobalFlags } from './global-flags';

/**
 * Options for the withSpinner helper function.
 */
interface WithSpinnerOptions {
  /**
   * The message to display in the spinner.
   */
  readonly message: string;
  /**
   * Global flags that control spinner behavior (quiet, json, color).
   */
  readonly flags: GlobalFlags;
}

/**
 * Wraps an async operation with a spinner.
 *
 * The spinner respects:
 * - `flags.quiet`: No spinner if quiet mode is enabled
 * - `flags.json === 'object'`: No spinner if JSON output is enabled
 * - Non-TTY environments: No spinner if stdout is not a TTY
 *
 * @param operation - The async operation to execute
 * @param options - Spinner configuration options
 * @returns The result of the operation
 */
export async function withSpinner<T>(
  operation: () => Promise<T>,
  options: WithSpinnerOptions,
): Promise<T> {
  const { message, flags } = options;

  // Skip spinner if quiet, JSON output, or non-TTY
  const shouldShowSpinner = !flags.quiet && flags.json !== 'object' && process.stdout.isTTY;

  if (!shouldShowSpinner) {
    // Just execute the operation without spinner
    return operation();
  }

  // Start spinner immediately
  const startTime = Date.now();
  const spinner = ora({
    text: message,
    color: flags.color !== false ? 'cyan' : false,
  }).start();

  try {
    // Execute the operation
    const result = await operation();

    // Mark spinner as succeeded
    const elapsed = Date.now() - startTime;
    spinner.succeed(`${message} (${elapsed}ms)`);

    return result;
  } catch (error) {
    // Mark spinner as failed
    spinner.fail(`${message} failed: ${error instanceof Error ? error.message : String(error)}`);

    // Re-throw the error
    throw error;
  }
}
