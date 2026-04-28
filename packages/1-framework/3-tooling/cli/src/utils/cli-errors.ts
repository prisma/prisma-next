/**
 * Re-export all domain error factories from @prisma-next/errors for convenience.
 * CLI-specific errors (e.g., Commander.js argument validation) can be added here if needed.
 */
export type { CliErrorConflict, CliErrorEnvelope } from '@prisma-next/errors/control';

import {
  CliStructuredError,
  errorConfigFileNotFound,
  errorConfigValidation,
  errorContractConfigMissing,
  errorContractMissingExtensionPacks,
  errorContractValidationFailed,
  errorDatabaseConnectionRequired,
  errorDriverRequired,
  errorFamilyReadMarkerSqlRequired,
  errorFileNotFound,
  errorMigrationCliInvalidConfigArg,
  errorMigrationPlanningFailed,
  errorQueryRunnerFactoryRequired,
  errorTargetMigrationNotSupported,
  errorUnexpected,
} from '@prisma-next/errors/control';
import { errorRuntime } from '@prisma-next/errors/execution';
import type { MigrationToolsError } from '@prisma-next/migration-tools/errors';

export {
  CliStructuredError,
  errorConfigFileNotFound,
  errorConfigValidation,
  errorContractConfigMissing,
  errorContractMissingExtensionPacks,
  errorContractValidationFailed,
  errorDatabaseConnectionRequired,
  errorDriverRequired,
  errorFamilyReadMarkerSqlRequired,
  errorFileNotFound,
  errorMigrationCliInvalidConfigArg,
  errorMigrationPlanningFailed,
  errorQueryRunnerFactoryRequired,
  errorTargetMigrationNotSupported,
  errorUnexpected,
};
export {
  ERROR_CODE_DESTRUCTIVE_CHANGES,
  errorDestructiveChanges,
  errorHashMismatch,
  errorMarkerMissing,
  errorMarkerRequired,
  errorRunnerFailed,
  errorRuntime,
  errorSchemaVerificationFailed,
  errorTargetMismatch,
} from '@prisma-next/errors/execution';
export {
  errorMigrationFileMissing,
  errorMigrationInvalidDefaultExport,
  errorMigrationPlanNotArray,
  errorUnfilledPlaceholder,
  placeholder,
} from '@prisma-next/errors/migration';

/**
 * Maps a `MigrationToolsError` raised by the migration-tools loader/graph
 * surface (`readMigrationPackage`, `readMigrationsDir`, `readRefs`,
 * `resolveRef`, `reconstructGraph`, ...) into a CLI `errorRuntime` envelope.
 *
 * The full `error.details` payload is forwarded into `meta` so machine
 * consumers (`--json`) see structural fields like `dir`, `storedHash`,
 * `computedHash` (for `MIGRATION.HASH_MISMATCH`) alongside the stable
 * `code`. The user-visible `summary`/`why`/`fix` text is unchanged.
 *
 * Callers are expected to gate on `MigrationToolsError.is(error)` first
 * (mirroring the original inline pattern); non-`MigrationToolsError`
 * values are caller-classified (rethrow, wrap with command-specific
 * `errorUnexpected`, etc.).
 */
export function mapMigrationToolsError(error: MigrationToolsError): CliStructuredError {
  return errorRuntime(error.message, {
    why: error.why,
    fix: error.fix,
    meta: { code: error.code, ...(error.details ?? {}) },
  });
}
