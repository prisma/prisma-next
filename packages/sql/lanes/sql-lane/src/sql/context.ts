import type { RuntimeContext } from '@prisma-next/runtime';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-target';

export interface SqlContext<TContract extends SqlContract<SqlStorage>> {
  readonly context: RuntimeContext<TContract>;
  readonly contract: TContract;
  readonly adapter: RuntimeContext<TContract>['adapter'];
}

export function createSqlContext<TContract extends SqlContract<SqlStorage>>(
  context: RuntimeContext<TContract>,
): SqlContext<TContract> {
  return {
    context,
    contract: context.contract,
    adapter: context.adapter,
  };
}
