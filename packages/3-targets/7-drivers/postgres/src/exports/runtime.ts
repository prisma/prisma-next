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
const USE_BEFORE_CONNECT_MESSAGE =
  'Postgres driver not connected. Call connect(binding) before acquireConnection or execute.';

class PostgresUnboundDriver implements PostgresRuntimeDriver {
  readonly familyId = 'sql' as const;
  readonly targetId = 'postgres' as const;

  async connect(): Promise<void> {
    throw new Error(USE_BEFORE_CONNECT_MESSAGE);
  }

  async acquireConnection(): Promise<never> {
    throw new Error(USE_BEFORE_CONNECT_MESSAGE);
  }

  async close(): Promise<void> {}

  execute(): AsyncIterable<never> {
    return {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            throw new Error(USE_BEFORE_CONNECT_MESSAGE);
          },
        };
      },
    };
  }

  async query(): Promise<never> {
    throw new Error(USE_BEFORE_CONNECT_MESSAGE);
  }
}

const postgresRuntimeDriverDescriptor: RuntimeDriverDescriptor<
  'sql',
  'postgres',
  PostgresDriverOptions,
  PostgresRuntimeDriver
> = {
  ...postgresDriverDescriptorMeta,
  create(options?: PostgresDriverOptions): PostgresRuntimeDriver {
    if (options?.connect) {
      return createPostgresDriverFromOptions(options) as PostgresRuntimeDriver;
    }
    return new PostgresUnboundDriver();
  },
};

export default postgresRuntimeDriverDescriptor;
export type {
  CreatePostgresDriverOptions,
  PostgresDriverOptions,
  QueryResult,
} from '../postgres-driver';
export { createPostgresDriver, createPostgresDriverFromOptions } from '../postgres-driver';
