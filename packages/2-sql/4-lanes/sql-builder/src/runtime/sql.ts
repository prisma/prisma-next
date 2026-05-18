import type { Contract } from '@prisma-next/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import type { Db, TableProxyContract } from '../types/db';
import type { BuilderContext } from './builder-base';
import { TableProxyImpl } from './table-proxy-impl';

export interface SqlOptions<C extends Contract<SqlStorage> & TableProxyContract> {
  readonly context: ExecutionContext<C>;
}

export function sql<C extends Contract<SqlStorage> & TableProxyContract>(
  options: SqlOptions<C>,
): Db<C> {
  const { context } = options;
  const ctx: BuilderContext = {
    capabilities: context.contract.capabilities,
    queryOperationTypes: context.queryOperations.entries(),
    target: context.contract.target ?? 'unknown',
    storageHash: context.contract.storage.storageHash ?? 'unknown',
    storage: context.contract.storage,
    applyMutationDefaults: (options) => context.applyMutationDefaults(options),
  };

  return new Proxy({} as Db<C>, {
    get(_target, prop: string) {
      const unbound = context.contract.storage.namespaces[UNBOUND_NAMESPACE_ID];
      const tables = unbound?.tables ?? {};
      const table = Object.hasOwn(tables, prop) ? tables[prop] : undefined;
      if (table) {
        return new TableProxyImpl(prop, table, prop, ctx);
      }
      return undefined;
    },
  });
}
