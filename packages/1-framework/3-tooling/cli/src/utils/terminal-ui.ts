import * as clack from '@clack/prompts';
import { bold, cyan, dim, green, red, yellow } from 'colorette';
import { shutdownSignal } from './shutdown';

/**
 * Composable CLI output abstraction.
 *
 * Follows the Unix convention of separating data from decoration:
 * - **stdout** — data output only (`ui.output()`). This is what scripts and pipes capture.
 * - **stderr** — all decoration (spinners, logs, notes, intro/outro). Visible in terminal, invisible in pipes.
 *
 * Rules:
 * 1. All methods except `output()` write to stderr via Clack's `{ output: process.stderr }` — but only in interactive mode.
 * 2. `output(data)` writes to stdout only when piped — it checks `process.stdout.isTTY` and is a no-op in interactive terminals.
 * 3. When stdout is piped, ALL decoration is suppressed — `isInteractive` gates every decoration method.
 * 4. Never write data to stderr — decoration methods are for human context only.
 * 5. Never write decoration to stdout — it breaks pipes, `$(...)` captures, and `> file` redirects.
 */
export class TerminalUI {
  /**
   * True when stdout is a TTY (interactive terminal).
   * False when piped (e.g., `prisma-next db verify | jq`).
   */
  readonly isInteractive: boolean;

  /**
   * Whether color output is enabled.
   */
  readonly useColor: boolean;

  private static readonly stderrOpts = { output: process.stderr } as const;

  constructor(options?: {
    readonly color?: boolean | undefined;
    readonly interactive?: boolean | undefined;
  }) {
    // --interactive/--no-interactive override TTY detection
    this.isInteractive = options?.interactive ?? !!process.stdout.isTTY;
    this.useColor =
      options?.color ?? (this.isInteractive && !process.env['NO_COLOR'] && !process.env['CI']);
  }

  // ---------------------------------------------------------------------------
  // Decoration → stderr (only in interactive mode)
  // ---------------------------------------------------------------------------

  /**
   * Log a message line to stderr. No-op when piped.
   */
  log(message: string): void {
    if (!this.isInteractive) return;
    clack.log.message(message, TerminalUI.stderrOpts);
  }

  /**
   * Log a success message to stderr. No-op when piped.
   */
  success(message: string): void {
    if (!this.isInteractive) return;
    clack.log.success(message, TerminalUI.stderrOpts);
  }

  /**
   * Log a warning message to stderr. No-op when piped.
   */
  warn(message: string): void {
    if (!this.isInteractive) return;
    clack.log.warn(message, TerminalUI.stderrOpts);
  }

  /**
   * Log an error message to stderr. Always writes (errors matter even in pipes).
   */
  error(message: string): void {
    clack.log.error(message, TerminalUI.stderrOpts);
  }

  /**
   * Log an info message to stderr. No-op when piped.
   */
  info(message: string): void {
    if (!this.isInteractive) return;
    clack.log.info(message, TerminalUI.stderrOpts);
  }

  /**
   * Log a step message to stderr. No-op when piped.
   */
  step(message: string): void {
    if (!this.isInteractive) return;
    clack.log.step(message, TerminalUI.stderrOpts);
  }

  /**
   * Display a note box on stderr. No-op when piped.
   */
  note(message: string, title?: string): void {
    if (!this.isInteractive) return;
    clack.note(message, title, TerminalUI.stderrOpts);
  }

  /**
   * Display intro banner on stderr. No-op when piped.
   */
  intro(title?: string): void {
    if (!this.isInteractive) return;
    clack.intro(title, TerminalUI.stderrOpts);
  }

  /**
   * Display outro banner on stderr. No-op when piped.
   */
  outro(message?: string): void {
    if (!this.isInteractive) return;
    clack.outro(message, TerminalUI.stderrOpts);
  }

  /**
   * Create a Clack spinner on stderr with a 100ms delay threshold.
   * The spinner only appears if the operation takes longer than the threshold,
   * avoiding flicker for fast operations. Returns a no-op spinner when not interactive.
   */
  spinner(delayMs = 100): clack.SpinnerResult {
    const noop: clack.SpinnerResult = {
      start: () => {},
      stop: () => {},
      cancel: () => {},
      error: () => {},
      message: () => {},
      clear: () => {},
      get isCancelled() {
        return false;
      },
    };

    if (!this.isInteractive) {
      return noop;
    }

    // Wrap the real spinner with a delay: only show it after `delayMs`
    let inner: clack.SpinnerResult | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pendingMsg: string | undefined;
    let settled = false;

    const ensureCleared = () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    };

    // Cancel the spinner if a shutdown signal fires
    const onAbort = () => {
      if (!settled) {
        settled = true;
        ensureCleared();
        if (inner) {
          inner.cancel('Interrupted');
        }
      }
    };
    if (!shutdownSignal.aborted) {
      shutdownSignal.addEventListener('abort', onAbort, { once: true });
    }

    return {
      start(msg?: string) {
        pendingMsg = msg;
        timer = setTimeout(() => {
          if (!settled) {
            inner = clack.spinner(TerminalUI.stderrOpts);
            inner.start(pendingMsg);
          }
        }, delayMs);
      },
      stop(msg?: string) {
        settled = true;
        ensureCleared();
        if (inner) {
          inner.stop(msg);
        }
      },
      cancel(msg?: string) {
        settled = true;
        ensureCleared();
        if (inner) {
          inner.cancel(msg);
        }
      },
      error(msg?: string) {
        settled = true;
        ensureCleared();
        if (inner) {
          inner.error(msg);
        }
      },
      message(msg?: string) {
        pendingMsg = msg;
        if (inner) {
          inner.message(msg);
        }
      },
      clear() {
        settled = true;
        ensureCleared();
        if (inner) {
          inner.clear();
        }
      },
      get isCancelled() {
        return inner?.isCancelled ?? false;
      },
    };
  }

  /**
   * Write a raw line to stderr. No-op when piped.
   * Use for decoration that doesn't fit Clack's log format (e.g. styled headers).
   */
  stderr(message: string): void {
    if (!this.isInteractive) return;
    process.stderr.write(`${message}\n`);
  }

  // ---------------------------------------------------------------------------
  // Data → stdout (only when piped)
  // ---------------------------------------------------------------------------

  /**
   * Write machine-readable data to stdout.
   * Always writes — if a command calls output(), there is data to emit.
   *
   * This is what scripts and pipes capture: `prisma-next db verify --json | jq .ok`
   */
  output(data: string): void {
    process.stdout.write(`${data}\n`);
  }

  // ---------------------------------------------------------------------------
  // Color helpers
  // ---------------------------------------------------------------------------

  green(text: string): string {
    return this.useColor ? green(text) : text;
  }
  red(text: string): string {
    return this.useColor ? red(text) : text;
  }
  cyan(text: string): string {
    return this.useColor ? cyan(text) : text;
  }
  dim(text: string): string {
    return this.useColor ? dim(text) : text;
  }
  bold(text: string): string {
    return this.useColor ? bold(text) : text;
  }
  yellow(text: string): string {
    return this.useColor ? yellow(text) : text;
  }
}
