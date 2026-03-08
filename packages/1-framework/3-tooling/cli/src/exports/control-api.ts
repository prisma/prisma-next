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

// Contract enrichment (merges framework-derived capabilities and extension pack metadata into IR)
export { enrichContractIR } from '../control-api/contract-enrichment';

// Standalone operations (for tooling that doesn't need full client)
export { executeContractEmit } from '../control-api/operations/contract-emit';

// CLI-specific types
export type {
  ContractEmitOptions,
  ContractEmitResult,
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
