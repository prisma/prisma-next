import type {
  RuntimeAdapterDescriptor,
  RuntimeAdapterInstance,
} from '@prisma-next/core-execution-plane/types';
import type { Adapter, QueryAst } from '@prisma-next/sql-relational-core/ast';
import { createPostgresAdapter } from '../core/adapter';
import { manifest } from '../core/manifest';
import type { PostgresContract, PostgresLoweredStatement } from '../core/types';

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
  kind: 'adapter',
  familyId: 'sql',
  targetId: 'postgres',
  id: 'postgres',
  manifest,
  create(): SqlRuntimeAdapter {
    return createPostgresAdapter() as unknown as SqlRuntimeAdapter;
  },
};

export default postgresRuntimeAdapterDescriptor;
