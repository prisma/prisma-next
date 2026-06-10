import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { type Runtime, SqlRuntimeBase } from '@prisma-next/sql-runtime';

/**
 * Postgres target runtime. The named dependency surface; the class `PostgresRuntimeImpl` is exported solely as an extension seam.
 */
export interface PostgresRuntime extends Runtime {}

export class PostgresRuntimeImpl<
  TContract extends Contract<SqlStorage> = Contract<SqlStorage>,
> extends SqlRuntimeBase<TContract> {}
