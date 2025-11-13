import { CliStructuredError } from './cli-errors';

export interface CliErrorEnvelope {
  readonly code: string;
  readonly domain: string;
  readonly severity: 'error' | 'warn' | 'info';
  readonly summary: string;
  readonly why?: string;
  readonly fix?: string;
  readonly where?: {
    readonly path?: string;
    readonly line?: number;
  };
  readonly meta?: Record<string, unknown>;
  readonly docsUrl?: string;
  /**
   * Exit code for this error. 2 for usage/config errors, 1 for runtime errors.
   */
  readonly exitCode?: number;
}

/**
 * Creates a CLI error envelope with PN-CLI-4xxx code.
 */
export function createCliError(
  code: string,
  summary: string,
  options?: {
    readonly why?: string;
    readonly fix?: string;
    readonly where?: { readonly path?: string; readonly line?: number };
    readonly meta?: Record<string, unknown>;
    readonly docsUrl?: string;
    readonly exitCode?: number;
  },
): CliErrorEnvelope {
  return {
    code: `PN-CLI-${code}`,
    domain: 'CLI',
    severity: 'error',
    summary,
    ...(options?.why ? { why: options.why } : {}),
    ...(options?.fix ? { fix: options.fix } : {}),
    ...(options?.where ? { where: options.where } : {}),
    ...(options?.meta ? { meta: options.meta } : {}),
    ...(options?.docsUrl ? { docsUrl: options.docsUrl } : {}),
    ...(options?.exitCode !== undefined ? { exitCode: options.exitCode } : {}),
  };
}

/**
 * Creates a runtime error envelope with PN-RTM-3xxx code.
 */
export function createRtmError(
  code: string,
  summary: string,
  options?: {
    readonly why?: string;
    readonly fix?: string;
    readonly where?: { readonly path?: string; readonly line?: number };
    readonly meta?: Record<string, unknown>;
    readonly docsUrl?: string;
    readonly exitCode?: number;
  },
): CliErrorEnvelope {
  return {
    code: `PN-RTM-${code}`,
    domain: 'RTM',
    severity: 'error',
    summary,
    ...(options?.why ? { why: options.why } : {}),
    ...(options?.fix ? { fix: options.fix } : {}),
    ...(options?.where ? { where: options.where } : {}),
    ...(options?.meta ? { meta: options.meta } : {}),
    ...(options?.docsUrl ? { docsUrl: options.docsUrl } : {}),
    exitCode: options?.exitCode ?? 1,
  };
}

import { CliStructuredError } from './cli-errors';

/**
 * Maps errors to CLI error envelopes.
 * If the error is a CliStructuredError, extracts fields directly.
 * Otherwise, falls back to generic error handling.
 */
export function mapErrorToCliEnvelope(error: unknown): CliErrorEnvelope {
  // Structured errors contain all the information we need
  if (error instanceof CliStructuredError) {
    const codePrefix = error.domain === 'CLI' ? 'PN-CLI-' : 'PN-RTM-';
    return {
      code: `${codePrefix}${error.code}`,
      domain: error.domain,
      severity: error.severity,
      summary: error.message,
      ...(error.why ? { why: error.why } : {}),
      ...(error.fix ? { fix: error.fix } : {}),
      ...(error.where ? { where: error.where } : {}),
      ...(error.meta ? { meta: error.meta } : {}),
      ...(error.docsUrl ? { docsUrl: error.docsUrl } : {}),
      ...(error.exitCode !== undefined ? { exitCode: error.exitCode } : {}),
    };
  }

  // Fallback for generic Error objects (should be rare after migration)
  if (error instanceof Error) {
    return createCliError('4999', 'Unexpected error', {
      why: error.message,
      fix: 'Check the error message and try again',
      exitCode: 1,
    });
  }

  // Fallback for non-Error values
  return createCliError('4999', 'Unexpected error', {
    why: String(error),
    fix: 'Check the error message and try again',
    exitCode: 1,
  });
}
