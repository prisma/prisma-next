import type { Contract } from '@prisma-next/contract/types';
import { runtimeError } from '@prisma-next/framework-components/runtime';
import type { SqlStorage, StorageTable } from '@prisma-next/sql-contract/types';
import type { RawSqlAdapter } from '@prisma-next/sql-relational-core/expression';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import type { Db, TableProxyContract } from '../types/db';
import type { BuilderContext } from './builder-base';
import { TableProxyImpl } from './table-proxy-impl';

export interface SqlOptions<C extends Contract<SqlStorage> & TableProxyContract> {
  readonly context: ExecutionContext<C>;
  /** Target adapter wiring for raw-SQL codec inference. When omitted, `fns.rawSql` throws on use — provide one when raw SQL is in scope. */
  readonly adapter?: RawSqlAdapter;
}

const noAdapter: RawSqlAdapter = {
  inferCodec() {
    throw runtimeError(
      'RUNTIME.RAW_SQL_NO_ADAPTER',
      'fns.rawSql was invoked but no adapter was wired into sql(). Construct the client via a target facade (e.g. postgres() / sqlite()) or pass `adapter` to sql({...}) directly.',
    );
  },
};

// Find a table by name across every declared namespace. Mirrors the
// flat-DSL contract (db.<tableName>): the first namespace that declares
// `name` wins. Name collisions across namespaces are a type-level error
// at the DSL call site; landing the namespace-aware DSL is tracked
// separately.
function findTableAcrossNamespaces(storage: SqlStorage, name: string): StorageTable | undefined {
  for (const ns of Object.values(storage.namespaces)) {
    const tables = (ns as { tables?: Readonly<Record<string, StorageTable>> }).tables ?? {};
    if (Object.hasOwn(tables, name)) {
      return tables[name];
    }
  }
  return undefined;
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
    adapter: options.adapter ?? noAdapter,
  };

  return new Proxy({} as Db<C>, {
    get(_target, prop: string) {
      const table = findTableAcrossNamespaces(context.contract.storage, prop);
      if (table) {
        return new TableProxyImpl(prop, table, prop, ctx);
      }
      return undefined;
    },
  });
}
