import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { QueryLaneContext } from '@prisma-next/sql-relational-core/query-lane-context';

export type OrmContext<TContract extends SqlContract<SqlStorage>> = QueryLaneContext<TContract>;

export function createOrmContext<TContract extends SqlContract<SqlStorage>>(
  context: QueryLaneContext<TContract>,
): OrmContext<TContract> {
  return context;
}
