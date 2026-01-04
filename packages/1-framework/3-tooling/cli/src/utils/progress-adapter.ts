import ora from 'ora';
import type { ControlProgressEvent, OnControlProgress } from '../control-api/types';
import type { GlobalFlags } from './global-flags';

/**
 * Options for creating a progress adapter.
 */
interface ProgressAdapterOptions {
  /**
   * Global flags that control progress output behavior (quiet, json, color).
   */
  readonly flags: GlobalFlags;
}

/**
 * State for tracking active spans in the progress adapter.
 */
interface SpanState {
  readonly spinner: ReturnType<typeof ora>;
  readonly startTime: number;
}

/**
 * Creates a progress adapter that converts control-api progress events
 * into CLI spinner/progress output.
 *
 * The adapter:
 * - Starts/succeeds spinners for top-level span boundaries
 * - Prints per-operation lines for nested spans (e.g., migration operations under 'apply')
 * - Respects quiet/json/non-TTY flags (no-op in those cases)
 *
 * @param options - Progress adapter configuration
 * @returns An onProgress callback compatible with control-api operations
 */
export function createProgressAdapter(options: ProgressAdapterOptions): OnControlProgress {
  const { flags } = options;

  // Skip progress if quiet, JSON output, or non-TTY
  const shouldShowProgress = !flags.quiet && flags.json !== 'object' && process.stdout.isTTY;

  if (!shouldShowProgress) {
    // Return a no-op callback
    return () => {
      // No-op
    };
  }

  // Track active spans by spanId
  const activeSpans = new Map<string, SpanState>();

  return (event: ControlProgressEvent) => {
    if (event.kind === 'spanStart') {
      // Nested spans (with parentSpanId) are printed as lines, not spinners
      if (event.parentSpanId) {
        console.log(`  → ${event.label}...`);
        return;
      }

      // Top-level spans get a spinner
      const spinner = ora({
        text: event.label,
        color: flags.color !== false ? 'cyan' : false,
      }).start();

      activeSpans.set(event.spanId, {
        spinner,
        startTime: Date.now(),
      });
    } else if (event.kind === 'spanEnd') {
      // Complete the spinner for this span (only top-level spans have spinners)
      const spanState = activeSpans.get(event.spanId);
      if (spanState) {
        const elapsed = Date.now() - spanState.startTime;
        if (event.outcome === 'skipped') {
          spanState.spinner.info(`${spanState.spinner.text} (skipped)`);
        } else {
          spanState.spinner.succeed(`${spanState.spinner.text} (${elapsed}ms)`);
        }
        activeSpans.delete(event.spanId);
      }
      // Nested span ends are no-ops (could log completion if needed)
    }
  };
}
