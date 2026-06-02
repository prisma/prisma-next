import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { RawCodecInferer } from '@prisma-next/sql-relational-core/expression';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import type { Db, TableProxyContract } from '../types/db';
import type { BuilderContext } from './builder-base';
import { resolveTableForFlatName } from './resolve-table';
import { TableProxyImpl } from './table-proxy-impl';

export interface SqlOptions<C extends Contract<SqlStorage> & TableProxyContract> {
  readonly context: ExecutionContext<C>;
  readonly rawCodecInferer: RawCodecInferer;
}

export function sql<C extends Contract<SqlStorage> & TableProxyContract>(
  options: SqlOptions<C>,
): Db<C> {
  const { context, rawCodecInferer } = options;
  const ctx: BuilderContext = {
    capabilities: context.contract.capabilities,
    queryOperationTypes: context.queryOperations.entries(),
    target: context.contract.target ?? 'unknown',
    storageHash: context.contract.storage.storageHash ?? 'unknown',
    storage: context.contract.storage,
    applyMutationDefaults: (options) => context.applyMutationDefaults(options),
    rawCodecInferer,
  };

  return new Proxy({} as Db<C>, {
    get(_target, prop: string) {
      const resolved = resolveTableForFlatName(context.contract.storage, prop);
      if (resolved) {
        return new TableProxyImpl(prop, resolved.table, prop, ctx, resolved.namespaceId);
      }
      return undefined;
    },
  });
}
