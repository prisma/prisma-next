import type { Command } from 'commander';
import { vi } from 'vitest';

// Module-level variable to track exit code (more reliable than vi.fn().mock.calls when mock throws)
let lastExitCode: number | undefined;

/**
 * Gets the exit code from the process.exit mock.
 * Returns undefined if process.exit hasn't been called yet.
 * Note: process.exit() without argument defaults to 0, but we return undefined to distinguish "not called" from "called with 0".
 * If you need to check for success (exit code 0), check if executeCommand didn't throw instead.
 */
export function getExitCode(): number | undefined {
  return lastExitCode;
}

/**
 * Resets the exit code tracking. Called automatically by setupCommandMocks().
 */
export function resetExitCode(): void {
  lastExitCode = undefined;
}

/**
 * Executes a command and catches process.exit errors (which are expected in tests).
 * Returns the exit code that was passed to process.exit(), or 0 if process.exit() wasn't called.
 * For real errors (not process.exit), returns 1 to indicate failure.
 * This handles cases where validation errors are thrown before process.exit() is called.
 */
export async function executeCommand(command: Command, args: string[]): Promise<number> {
  try {
    // Use { from: 'user' } to tell Commander these are user args, not process.argv format
    // process.argv format would be ['node', 'script.js', '--option', 'value']
    // User args format is just ['--option', 'value']
    await command.parseAsync(args, { from: 'user' });
    // Command completed successfully without calling process.exit()
    return 0;
  } catch (error) {
    // process.exit throws an error in tests - extract the exit code
    if (error instanceof Error && error.message === 'process.exit called') {
      const exitCode = getExitCode() ?? 0; // Default to 0 if not set
      // For success (exit code 0), swallow the error
      // For errors (non-zero), re-throw so tests can check console errors
      if (exitCode !== 0) {
        throw error;
      }
      // Exit code 0 - success, don't throw
      return 0;
    }
    // Real error (not process.exit), re-throw
    throw error;
  }
}

/**
 * Sets up console and process.exit mocks for CLI command tests.
 * Returns cleanup functions and arrays to capture console output.
 */
export function setupCommandMocks(): {
  consoleOutput: string[];
  consoleErrors: string[];
  cleanup: () => void;
} {
  const consoleOutput: string[] = [];
  const consoleErrors: string[] = [];

  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const originalExit = process.exit;

  // Reset exit code tracking
  resetExitCode();

  // Mock console first (before process.exit) so errors are captured
  console.log = vi.fn((...args: unknown[]) => {
    consoleOutput.push(args.map(String).join(' '));
  }) as typeof console.log;

  console.error = vi.fn((...args: unknown[]) => {
    consoleErrors.push(args.map(String).join(' '));
  }) as typeof console.error;

  // Mock process.exit to record the exit code and throw
  // We record the exit code BEFORE throwing since vi.fn().mock.calls may not be
  // reliably accessible when an error is thrown inside the mock implementation
  process.exit = vi.fn((code?: number) => {
    lastExitCode = code ?? 0;
    throw new Error('process.exit called');
  }) as unknown as typeof process.exit;

  const cleanup = () => {
    console.log = originalConsoleLog;
    console.error = originalConsoleError;
    process.exit = originalExit;
    resetExitCode();
  };

  return { consoleOutput, consoleErrors, cleanup };
}
