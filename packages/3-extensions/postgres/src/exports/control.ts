/**
 * Control-API facade for Postgres.
 *
 * Collapses the five-package wiring required to drive control-side
 * operations (`dbInit`, `dbUpdate`, `dbVerify`, `migrate`, …) into
 * a single `createPostgresControlClient()` call. Mirrors what
 * `@prisma-next/postgres/runtime` did for the query side.
 */

import postgresAdapter from '@prisma-next/adapter-postgres/control';
import {
  type ControlClient,
  type ControlClientOptions,
  createControlClient,
} from '@prisma-next/cli/control-api';
import postgresDriver from '@prisma-next/driver-postgres/control';
import sql from '@prisma-next/family-sql/control';
import postgres from '@prisma-next/target-postgres/control';
import { ifDefined } from '@prisma-next/utils/defined';

export interface PostgresControlClientOptions {
  /**
   * Default Postgres connection string. When set, operations like `dbInit`
   * auto-connect without an explicit `connect()` call. Equivalent to the
   * `connection` field on the underlying `ControlClientOptions`.
   */
  readonly connection?: string;
  /**
   * Composed extension descriptors. Pass the same descriptors here that
   * the contract was authored against.
   */
  readonly extensionPacks?: ControlClientOptions['extensionPacks'];
}

export function createPostgresControlClient(
  options: PostgresControlClientOptions = {},
): ControlClient {
  const clientOptions: ControlClientOptions = {
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    ...ifDefined('connection', options.connection),
    ...ifDefined('extensionPacks', options.extensionPacks),
  };
  return createControlClient(clientOptions);
}

export type { ControlClient };
