import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { SqlRuntime } from '@prisma-next/sql-runtime';

/**
 * SQLite target runtime. Extension authors subclass this to add
 * SQLite-specific capabilities; app code uses the `Runtime` interface
 * returned by `sqlite()`, not this class.
 */
export class SqliteRuntime<
  TContract extends Contract<SqlStorage> = Contract<SqlStorage>,
> extends SqlRuntime<TContract> {}
