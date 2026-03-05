/**
 * Re-export all domain error factories from core-control-plane for convenience.
 * CLI-specific errors (e.g., Commander.js argument validation) can be added here if needed.
 */
export type { CliErrorConflict, CliErrorEnvelope } from '@prisma-next/core-control-plane/errors';
export {
  CliStructuredError,
  errorConfigFileNotFound,
  errorConfigValidation,
  errorContractConfigMissing,
  errorContractMissingExtensionPacks,
  errorContractValidationFailed,
  errorDatabaseConnectionRequired,
  errorDestructiveChanges,
  errorDriverRequired,
  errorFamilyReadMarkerSqlRequired,
  errorFileNotFound,
  errorHashMismatch,
  errorMarkerMissing,
  errorMigrationPlanningFailed,
  errorQueryRunnerFactoryRequired,
  errorRunnerFailed,
  errorRuntime,
  errorTargetMigrationNotSupported,
  errorTargetMismatch,
  errorUnexpected,
} from '@prisma-next/core-control-plane/errors';
