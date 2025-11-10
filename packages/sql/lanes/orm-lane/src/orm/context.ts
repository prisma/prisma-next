import type { RuntimeContext } from '@prisma-next/sql-runtime';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-target';

export interface OrmContext<TContract extends SqlContract<SqlStorage>> {
  readonly context: RuntimeContext<TContract>;
  readonly contract: TContract;
  readonly adapter: RuntimeContext<TContract>['adapter'];
}

export function createOrmContext<TContract extends SqlContract<SqlStorage>>(
  context: RuntimeContext<TContract>,
): OrmContext<TContract> {
  return {
    context,
    contract: context.contract,
    adapter: context.adapter,
  };
}
