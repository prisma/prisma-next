import type {
  RuntimeAdapterDescriptor,
  RuntimeAdapterInstance,
} from '@prisma-next/core-execution-plane/types';
import type { Adapter, QueryAst } from '@prisma-next/sql-relational-core/ast';
import { createPostgresAdapter } from '../core/adapter.ts';
import { postgresAdapterDescriptorMeta } from '../core/descriptor-meta.ts';
import type { PostgresContract, PostgresLoweredStatement } from '../core/types.ts';

/**
 * SQL runtime adapter interface for Postgres.
 * Extends RuntimeAdapterInstance with SQL-specific adapter methods.
 */
export interface SqlRuntimeAdapter
  extends RuntimeAdapterInstance<'sql', 'postgres'>,
    Adapter<QueryAst, PostgresContract, PostgresLoweredStatement> {}

/**
 * Postgres adapter descriptor for runtime plane.
 */
const postgresRuntimeAdapterDescriptor: RuntimeAdapterDescriptor<
  'sql',
  'postgres',
  SqlRuntimeAdapter
> = {
  ...postgresAdapterDescriptorMeta,
  create(): SqlRuntimeAdapter {
    return createPostgresAdapter();
  },
};

export default postgresRuntimeAdapterDescriptor;
