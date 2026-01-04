/**
 * Programmatic Control API for Prisma Next.
 *
 * This module exports the control client factory and types for programmatic
 * access to control-plane operations without using the CLI.
 *
 * @example
 * ```typescript
 * import { createPrismaNextControlClient } from '@prisma-next/cli/control-api';
 * import sql from '@prisma-next/family-sql/control';
 * import postgres from '@prisma-next/target-postgres/control';
 * import postgresAdapter from '@prisma-next/adapter-postgres/control';
 * import postgresDriver from '@prisma-next/driver-postgres/control';
 *
 * const client = createPrismaNextControlClient({
 *   family: sql,
 *   target: postgres,
 *   adapter: postgresAdapter,
 *   driver: postgresDriver,
 *   extensionPacks: [],
 * });
 *
 * try {
 *   await client.connect(databaseUrl);
 *   const result = await client.verify({ contractIR });
 * } finally {
 *   await client.close();
 * }
 * ```
 */

// Client factory
export { createPrismaNextControlClient } from '../control-api/client';

// Types
export type {
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
  PrismaNextControlClient,
  SchemaVerifyOptions,
  SignDatabaseResult,
  SignOptions,
  VerifyDatabaseResult,
  VerifyDatabaseSchemaResult,
  VerifyOptions,
} from '../control-api/types';
