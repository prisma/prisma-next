import type {
  SchemaIssue,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/framework-components/control';
import { ifDefined } from '@prisma-next/utils/defined';
import { CliStructuredError } from './control';

// ============================================================================
// Runtime Errors (PN-RUN-3000-3030)
// ============================================================================

/**
 * Contract marker not found in database.
 */
export function errorMarkerMissing(options?: { readonly why?: string }): CliStructuredError {
  return new CliStructuredError('3001', 'Database not signed', {
    domain: 'RUN',
    why: options?.why ?? 'No database signature (marker) found',
    fix: 'Run `prisma-next db sign --db <url>` to sign the database',
  });
}

/**
 * Contract hash does not match database marker.
 */
export function errorHashMismatch(options?: {
  readonly why?: string;
  readonly expected?: string;
  readonly actual?: string;
}): CliStructuredError {
  return new CliStructuredError('3002', 'Hash mismatch', {
    domain: 'RUN',
    why: options?.why ?? 'Contract hash does not match database marker',
    fix: 'Migrate database or re-sign if intentional',
    ...(options?.expected !== undefined || options?.actual !== undefined
      ? {
          meta: {
            ...ifDefined('expected', options?.expected),
            ...ifDefined('actual', options?.actual),
          },
        }
      : {}),
  });
}

/**
 * Contract target does not match config target.
 */
export function errorTargetMismatch(
  expected: string,
  actual: string,
  options?: {
    readonly why?: string;
  },
): CliStructuredError {
  return new CliStructuredError('3003', 'Target mismatch', {
    domain: 'RUN',
    why:
      options?.why ??
      `Contract target does not match config target (expected: ${expected}, actual: ${actual})`,
    fix: 'Align contract target and config target',
    meta: { expected, actual },
  });
}

/**
 * Database marker is required but not found.
 * Used by commands that require a pre-existing marker as a precondition.
 */
export function errorMarkerRequired(options?: {
  readonly why?: string;
  readonly fix?: string;
}): CliStructuredError {
  return new CliStructuredError('3010', 'Database must be signed first', {
    domain: 'RUN',
    why: options?.why ?? 'No database signature (marker) found',
    fix: options?.fix ?? 'Run `prisma-next db init` first to sign the database',
  });
}

/**
 * Schema verification found mismatches between the database and the contract.
 * The full verification tree is preserved in `meta.verificationResult`.
 */
export function errorSchemaVerificationFailed(options: {
  readonly summary: string;
  readonly verificationResult: VerifyDatabaseSchemaResult;
  readonly issues?: readonly SchemaIssue[];
}): CliStructuredError {
  return new CliStructuredError('3004', options.summary, {
    domain: 'RUN',
    why: 'Database schema does not satisfy the contract',
    fix: 'Run `prisma-next db update` to reconcile, or adjust your contract to match the database',
    meta: {
      verificationResult: options.verificationResult,
      ...ifDefined('issues', options.issues),
    },
  });
}

/**
 * Migration runner failed during execution.
 */
export function errorRunnerFailed(
  summary: string,
  options?: {
    readonly why?: string;
    readonly fix?: string;
    readonly meta?: Record<string, unknown>;
  },
): CliStructuredError {
  return new CliStructuredError('3020', summary, {
    domain: 'RUN',
    why: options?.why ?? 'Migration runner failed',
    fix: options?.fix ?? 'Inspect the reported conflict and reconcile schema drift',
    ...(options?.meta ? { meta: options.meta } : {}),
  });
}

/** Error code for destructive changes that require explicit confirmation. */
export const ERROR_CODE_DESTRUCTIVE_CHANGES = '3030';

/**
 * Destructive operations require explicit confirmation via -y/--yes.
 */
export function errorDestructiveChanges(
  summary: string,
  options?: {
    readonly why?: string;
    readonly fix?: string;
    readonly meta?: Record<string, unknown>;
  },
): CliStructuredError {
  return new CliStructuredError(ERROR_CODE_DESTRUCTIVE_CHANGES, summary, {
    domain: 'RUN',
    why: options?.why ?? 'Planned operations include destructive changes that require confirmation',
    fix: options?.fix ?? 'Re-run with `-y` to apply, or use `--dry-run` to preview first',
    ...(options?.meta ? { meta: options.meta } : {}),
  });
}

/**
 * Generic runtime error.
 */
export function errorRuntime(
  summary: string,
  options?: {
    readonly why?: string;
    readonly fix?: string;
    readonly meta?: Record<string, unknown>;
  },
): CliStructuredError {
  return new CliStructuredError('3000', summary, {
    domain: 'RUN',
    ...(options?.why ? { why: options.why } : { why: 'Verification failed' }),
    ...(options?.fix ? { fix: options.fix } : { fix: 'Check contract and database state' }),
    ...(options?.meta ? { meta: options.meta } : {}),
  });
}
