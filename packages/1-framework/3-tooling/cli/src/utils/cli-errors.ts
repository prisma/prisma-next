/**
 * Re-export all domain error factories from @prisma-next/errors for convenience.
 * CLI-specific errors (e.g., Commander.js argument validation) can be added here if needed.
 */
export type { CliErrorConflict, CliErrorEnvelope } from '@prisma-next/errors/control';
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
  errorMigrationPlanningFailed,
  errorQueryRunnerFactoryRequired,
  errorTargetMigrationNotSupported,
  errorUnexpected,
} from '@prisma-next/errors/control';
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
} from '@prisma-next/errors/migration';
