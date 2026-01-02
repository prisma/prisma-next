import type {
  RuntimeDriverDescriptor,
  RuntimeDriverInstance,
} from '@prisma-next/core-execution-plane/types';
import type { SqlDriver } from '@prisma-next/sql-relational-core/ast';
import { postgresDriverDescriptorMeta } from '../core/descriptor-meta';
import type { PostgresDriverOptions } from '../postgres-driver';
import { createPostgresDriverFromOptions } from '../postgres-driver';

/**
 * Postgres runtime driver instance interface.
 * SqlDriver provides SQL-specific methods (execute, explain, close).
 * RuntimeDriverInstance provides target identification (familyId, targetId).
 * We use intersection type to combine both interfaces.
 */
export type PostgresRuntimeDriver = RuntimeDriverInstance<'sql', 'postgres'> & SqlDriver;

/**
 * Postgres driver descriptor for runtime plane.
 */
const postgresRuntimeDriverDescriptor: RuntimeDriverDescriptor<
  'sql',
  'postgres',
  PostgresRuntimeDriver
> = {
  ...postgresDriverDescriptorMeta,
  create(options: PostgresDriverOptions): PostgresRuntimeDriver {
    return createPostgresDriverFromOptions(options) as PostgresRuntimeDriver;
  },
};

export default postgresRuntimeDriverDescriptor;
export type {
  CreatePostgresDriverOptions,
  PostgresDriverOptions,
  QueryResult,
} from '../postgres-driver';
export { createPostgresDriver, createPostgresDriverFromOptions } from '../postgres-driver';
