/**
 * Programmatic Control API for Prisma Next.
 *
 * This module exports the control client factory and types for programmatic
 * access to control-plane operations without using the CLI.
 *
 * @see README.md "Programmatic Control API" section for usage examples
 * @module
 */

// Re-export core control plane types for consumer convenience
export type {
  ControlPlaneStack,
  SignDatabaseResult,
  VerifyDatabaseResult,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/core-control-plane/types';
// Client factory
export { createControlClient } from '../control-api/client';

// Standalone operations (for tooling that doesn't need full client)
export { executeContractEmit } from '../control-api/operations/contract-emit';

// CLI-specific types
export type {
  ContractEmitOptions,
  ContractEmitResult,
  ContractSourceLoader,
  ContractSourceValue,
  ControlActionName,
  ControlClient,
  ControlClientOptions,
  ControlProgressEvent,
  DbInitFailure,
  DbInitFailureCode,
  DbInitOptions,
  DbInitResult,
  DbInitSuccess,
  DbUpdateFailure,
  DbUpdateFailureCode,
  DbUpdateOptions,
  DbUpdateResult,
  DbUpdateSuccess,
  EmitContractConfig,
  EmitContractSource,
  EmitFailure,
  EmitFailureCode,
  EmitOptions,
  EmitResult,
  EmitSuccess,
  IntrospectOptions,
  OnControlProgress,
  SchemaVerifyOptions,
  SignOptions,
  VerifyOptions,
} from '../control-api/types';
