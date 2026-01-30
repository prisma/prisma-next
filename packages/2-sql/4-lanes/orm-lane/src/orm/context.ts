import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';

export type OrmContext<TContract extends SqlContract<SqlStorage>> = ExecutionContext<TContract>;

export function createOrmContext<TContract extends SqlContract<SqlStorage>>(
  context: ExecutionContext<TContract>,
): OrmContext<TContract> {
  return context;
}
