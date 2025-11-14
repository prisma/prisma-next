import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { QueryLaneContext } from '@prisma-next/sql-relational-core/query-lane-context';

export type SqlContext<TContract extends SqlContract<SqlStorage>> = QueryLaneContext<TContract>;

export function createSqlContext<TContract extends SqlContract<SqlStorage>>(
  context: QueryLaneContext<TContract>,
): SqlContext<TContract> {
  return context;
}
