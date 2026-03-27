import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import type { Runtime } from '@prisma-next/sql-runtime';
import type { Db } from '../types/db';
import type { BuilderContext } from './builder-base';
import { TableProxyImpl } from './table-proxy-impl';

export interface CreateDbOptions<C extends SqlContract<SqlStorage>> {
  readonly context: ExecutionContext<C>;
  readonly runtime: Runtime;
}

export function createDb<C extends SqlContract<SqlStorage>>(options: CreateDbOptions<C>): Db<C> {
  const { context, runtime } = options;
  const ctx: BuilderContext = {
    capabilities: context.contract.capabilities,
    queryOperationTypes: context.queryOperations.entries(),
    runtime,
    target: context.contract.target ?? 'unknown',
    storageHash: context.contract.storageHash ?? 'unknown',
  };

  return new Proxy({} as Db<C>, {
    get(_target, prop: string) {
      const table = context.contract.storage.tables[prop];
      if (table) {
        return new TableProxyImpl(prop, table, prop, ctx);
      }
      return undefined;
    },
  });
}
