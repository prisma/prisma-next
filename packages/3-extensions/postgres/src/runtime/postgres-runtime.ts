import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { SqlRuntime } from '@prisma-next/sql-runtime';

/**
 * Postgres target runtime. Extension authors subclass this to add
 * Postgres-specific capabilities; app code uses the `Runtime` interface
 * returned by `postgres()`, not this class.
 */
export class PostgresRuntime<
  TContract extends Contract<SqlStorage> = Contract<SqlStorage>,
> extends SqlRuntime<TContract> {}
