/**
 * Programmatic Control API for Prisma Next.
 *
 * This module exports the control client factory and types for programmatic
 * access to control-plane operations without using the CLI.
 *
 * @see README.md "Programmatic Control API" section for usage examples
 * @module
 */

// Client factory
export { createControlClient } from '../control-api/client';

// Types
export type {
  ControlClient,
  // Client options and interface
  ControlClientOptions,
  // Re-exported from core-control-plane
  ControlPlaneStack,
  // Result types
  DbInitFailure,
  DbInitFailureCode,
  // Operation options
  DbInitOptions,
  DbInitResult,
  DbInitSuccess,
  IntrospectOptions,
  SchemaVerifyOptions,
  SignDatabaseResult,
  SignOptions,
  VerifyDatabaseResult,
  VerifyDatabaseSchemaResult,
  VerifyOptions,
} from '../control-api/types';
