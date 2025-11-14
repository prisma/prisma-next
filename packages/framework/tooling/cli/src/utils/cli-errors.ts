/**
 * Re-export all domain error factories from core-control-plane for convenience.
 * CLI-specific errors (e.g., Commander.js argument validation) can be added here if needed.
 */
export type { CliErrorEnvelope } from '@prisma-next/core-control-plane/errors';
export {
  CliStructuredError,
  errorConfigFileNotFound,
  errorConfigValidation,
  errorContractConfigMissing,
  errorContractValidationFailed,
  errorDatabaseUrlRequired,
  errorDriverRequired,
  errorFamilyReadMarkerSqlRequired,
  errorFamilySchemaVerifierRequired,
  errorFileNotFound,
  errorHashMismatch,
  errorMarkerMissing,
  errorQueryRunnerFactoryRequired,
  errorRuntime,
  errorTargetMismatch,
  errorUnexpected,
} from '@prisma-next/core-control-plane/errors';
