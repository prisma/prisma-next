import type {
  RuntimeAdapterDescriptor,
  RuntimeAdapterInstance,
} from '@prisma-next/core-execution-plane/types';
import type { Adapter, QueryAst } from '@prisma-next/sql-relational-core/ast';
import { createSqliteAdapter } from '../core/adapter';
import { sqliteAdapterDescriptorMeta } from '../core/descriptor-meta';
import type { SqliteContract, SqliteLoweredStatement } from '../core/types';

/**
 * SQL runtime adapter interface for SQLite.
 * Extends RuntimeAdapterInstance with SQL-specific adapter methods.
 */
export interface SqlRuntimeAdapter
  extends RuntimeAdapterInstance<'sql', 'sqlite'>,
    Adapter<QueryAst, SqliteContract, SqliteLoweredStatement> {}

/**
 * SQLite adapter descriptor for runtime plane.
 */
const sqliteRuntimeAdapterDescriptor: RuntimeAdapterDescriptor<'sql', 'sqlite', SqlRuntimeAdapter> =
  {
    ...sqliteAdapterDescriptorMeta,
    create(): SqlRuntimeAdapter {
      return createSqliteAdapter();
    },
  };

export default sqliteRuntimeAdapterDescriptor;
