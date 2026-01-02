import type {
  RuntimeAdapterDescriptor,
  RuntimeAdapterInstance,
} from '@prisma-next/core-execution-plane/types';
import type { Adapter, QueryAst } from '@prisma-next/sql-relational-core/ast';
import { createPostgresAdapter } from '../core/adapter';
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
  version: '0.0.1',
  capabilities: {
    postgres: {
      orderBy: true,
      limit: true,
      lateral: true,
      jsonAgg: true,
      returning: true,
    },
  },
  types: {
    codecTypes: {
      import: {
        package: '@prisma-next/adapter-postgres/codec-types',
        named: 'CodecTypes',
        alias: 'PgTypes',
      },
    },
    storage: [
      { typeId: 'pg/text@1', familyId: 'sql', targetId: 'postgres', nativeType: 'text' },
      { typeId: 'pg/int4@1', familyId: 'sql', targetId: 'postgres', nativeType: 'int4' },
      { typeId: 'pg/int2@1', familyId: 'sql', targetId: 'postgres', nativeType: 'int2' },
      { typeId: 'pg/int8@1', familyId: 'sql', targetId: 'postgres', nativeType: 'int8' },
      { typeId: 'pg/float4@1', familyId: 'sql', targetId: 'postgres', nativeType: 'float4' },
      { typeId: 'pg/float8@1', familyId: 'sql', targetId: 'postgres', nativeType: 'float8' },
      { typeId: 'pg/timestamp@1', familyId: 'sql', targetId: 'postgres', nativeType: 'timestamp' },
      {
        typeId: 'pg/timestamptz@1',
        familyId: 'sql',
        targetId: 'postgres',
        nativeType: 'timestamptz',
      },
      { typeId: 'pg/bool@1', familyId: 'sql', targetId: 'postgres', nativeType: 'bool' },
    ],
  },
  create(): SqlRuntimeAdapter {
    return createPostgresAdapter();
  },
};

export default postgresRuntimeAdapterDescriptor;
