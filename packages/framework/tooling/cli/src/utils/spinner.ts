import ora, { type Ora } from 'ora';
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
  /**
   * Delay threshold in milliseconds before showing the spinner.
   * Default: 500ms
   */
  readonly delayThreshold?: number;
}

/**
 * Wraps an async operation with a spinner that only appears if the operation
 * takes longer than the delay threshold (default 500ms).
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
  const { message, flags, delayThreshold = 100 } = options;

  // Skip spinner if quiet, JSON output, or non-TTY
  const shouldShowSpinner = !flags.quiet && flags.json !== 'object' && process.stdout.isTTY;

  if (!shouldShowSpinner) {
    // Just execute the operation without spinner
    return operation();
  }

  // Start timer and operation
  const startTime = Date.now();
  let spinner: Ora | null = null;
  let timeoutId: NodeJS.Timeout | null = null;
  let operationCompleted = false;

  // Set up timeout to show spinner after delay threshold
  timeoutId = setTimeout(() => {
    if (!operationCompleted) {
      spinner = ora({
        text: message,
        color: flags.color !== false ? 'cyan' : false,
      }).start();
    }
  }, delayThreshold);

  try {
    // Execute the operation
    const result = await operation();
    operationCompleted = true;

    // Clear timeout if operation completed before delay threshold
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }

    // If spinner was shown, mark it as succeeded
    if (spinner !== null) {
      const elapsed = Date.now() - startTime;
      // TypeScript can't track that spinner is non-null due to closure, but we've checked above
      (spinner as Ora).succeed(`${message} (${elapsed}ms)`);
    }

    return result;
  } catch (error) {
    operationCompleted = true;

    // Clear timeout if operation failed before delay threshold
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }

    // If spinner was shown, mark it as failed
    if (spinner !== null) {
      // TypeScript can't track that spinner is non-null due to closure, but we've checked above
      (spinner as Ora).fail(
        `${message} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // Re-throw the error
    throw error;
  }
}
