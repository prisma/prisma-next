import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { type Runtime, SqlRuntimeBase } from '@prisma-next/sql-runtime';

/**
 * SQLite target runtime. The named dependency surface; the class `SqliteRuntimeImpl` is exported solely as an extension seam.
 */
export interface SqliteRuntime extends Runtime {}

export class SqliteRuntimeImpl<
  TContract extends Contract<SqlStorage> = Contract<SqlStorage>,
> extends SqlRuntimeBase<TContract> {}
