import type { Contract } from '@prisma-next/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { findTableByName, type SqlStorage } from '@prisma-next/sql-contract/types';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import type { Db } from '../types/db';
import type { BuilderContext } from './builder-base';
import { TableProxyImpl } from './table-proxy-impl';

export interface SqlOptions<C extends Contract<SqlStorage>> {
  readonly context: ExecutionContext<C>;
}

export function sql<C extends Contract<SqlStorage>>(options: SqlOptions<C>): Db<C> {
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
      const table = findTableByName(context.contract.storage, prop);
      if (table) {
        const schema =
          table.namespaceId !== UNBOUND_NAMESPACE_ID && table.namespaceId !== 'public'
            ? table.namespaceId
            : undefined;
        return new TableProxyImpl(prop, table, prop, ctx, schema);
      }
      return undefined;
    },
  });
}
