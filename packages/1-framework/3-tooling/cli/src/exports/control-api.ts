/**
 * Programmatic Control API for Prisma Next.
 *
 * This module exports a programmatic API for executing Prisma Next control-plane
 * operations without shelling out to the CLI. It's designed for programmatic use
 * cases like integration tests, CI/CD pipelines, and application scaffolding.
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
 *   const verifyResult = await client.verify({ contractIR });
 *   const initResult = await client.dbInit({ contractIR, mode: 'apply' });
 * } finally {
 *   await client.close();
 * }
 * ```
 *
 * @module @prisma-next/cli/control-api
 */

export { createPrismaNextControlClient } from '../control-api/client';

export type {
  // Client types
  ControlClientOptions,
  // Result types
  DbInitFailure,
  DbInitFailureCode,
  // Operation option types
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
