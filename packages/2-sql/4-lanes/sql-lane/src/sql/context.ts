import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';

export type SqlContext<TContract extends SqlContract<SqlStorage>> = ExecutionContext<TContract>;

export function createSqlContext<TContract extends SqlContract<SqlStorage>>(
  context: ExecutionContext<TContract>,
): SqlContext<TContract> {
  return context;
}
