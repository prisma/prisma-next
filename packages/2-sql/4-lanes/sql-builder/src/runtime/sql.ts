import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import type { Db } from '../types/db';
import type { BuilderContext } from './builder-base';
import { TableProxyImpl } from './table-proxy-impl';

export interface SqlOptions<C extends SqlContract<SqlStorage>> {
  readonly context: ExecutionContext<C>;
}

export function sql<C extends SqlContract<SqlStorage>>(options: SqlOptions<C>): Db<C> {
  const { context } = options;
  const ctx: BuilderContext = {
    capabilities: context.contract.capabilities,
    queryOperationTypes: context.queryOperations.entries(),
    target: context.contract.target ?? 'unknown',
    storageHash: context.contract.storageHash ?? 'unknown',
    applyMutationDefaults: (options) => context.applyMutationDefaults(options),
  };

  return new Proxy({} as Db<C>, {
    get(_target, prop: string) {
      const tables = context.contract.storage.tables;
      const table = Object.hasOwn(tables, prop) ? tables[prop] : undefined;
      if (table) {
        return new TableProxyImpl(prop, table, prop, ctx);
      }
      return undefined;
    },
  });
}
