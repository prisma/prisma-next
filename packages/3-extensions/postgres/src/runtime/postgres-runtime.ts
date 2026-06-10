import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { type Runtime, SqlRuntimeBase } from '@prisma-next/sql-runtime';

/**
 * The Postgres runtime interface. App code depends on this — `postgres()` returns it
 * and `Runtime` (the common interface) is the everyday parameter type.
 *
 * `PostgresRuntimeImpl` is the implementing class. It is exported so that other
 * extensions (e.g. Supabase) can subclass it; app code never references it directly.
 */
export interface PostgresRuntime extends Runtime {}

export class PostgresRuntimeImpl<
  TContract extends Contract<SqlStorage> = Contract<SqlStorage>,
> extends SqlRuntimeBase<TContract> {}
