/**
 * Re-export all domain error factories from @prisma-next/errors for convenience.
 * CLI-specific errors (e.g., Commander argument validation in the main CLI, or
 * clipanion parse errors in the migration-file CLI) can be added here if needed.
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
  errorMigrationCliUnknownFlag,
  errorMigrationPlanningFailed,
  errorQueryRunnerFactoryRequired,
  errorTargetMigrationNotSupported,
  errorUnexpected,
} from '@prisma-next/errors/control';
import { errorRuntime } from '@prisma-next/errors/execution';
import type { MigrationToolsError } from '@prisma-next/migration-tools/errors';
import type { RefResolutionError } from '@prisma-next/migration-tools/ref-resolution';

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
  errorMigrationCliUnknownFlag,
  errorMigrationPlanningFailed,
  errorQueryRunnerFactoryRequired,
  errorTargetMigrationNotSupported,
  errorUnexpected,
};

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

/**
 * Maps a `RefResolutionError` from the contract/migration reference
 * resolver into a CLI structured error envelope.
 */
export function mapRefResolutionError(error: RefResolutionError): CliStructuredError {
  switch (error.kind) {
    case 'not-found':
      return errorRuntime(`Not a known ${error.grammar} reference: "${error.input}"`, {
        why: `No ${error.grammar} matching "${error.input}" exists in the migration graph or refs index.`,
        fix:
          error.grammar === 'contract'
            ? 'Provide a valid contract hash, ref name, or migration directory name.'
            : 'Provide a valid migration directory name or migration hash.',
        meta: { input: error.input, grammar: error.grammar },
      });
    case 'ambiguous':
      return errorRuntime(`Ambiguous ${error.grammar} reference: "${error.input}"`, {
        why: `"${error.input}" matches multiple ${error.grammar}s: ${error.candidates.join(', ')}`,
        fix: 'Provide a longer prefix or use the full hash to disambiguate.',
        meta: { input: error.input, candidates: error.candidates, grammar: error.grammar },
      });
    case 'wrong-grammar':
      return errorRuntime(error.message, {
        why: error.message,
        fix: error.fix,
        meta: { input: error.input, expectedGrammar: error.expectedGrammar },
      });
    case 'invalid-format':
      return errorRuntime(`Invalid reference format: "${error.input}"`, {
        why: error.reason,
        fix: 'Provide a valid contract hash, ref name, or migration directory name.',
        meta: { input: error.input },
      });
  }
}
