import sqliteAdapter from '@prisma-next/adapter-sqlite/runtime';
import type { NamespacedEnums } from '@prisma-next/contract/enum-accessor';
import type { Contract } from '@prisma-next/contract/types';
import type { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import type { Db } from '@prisma-next/sql-builder/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { RawSqlTag } from '@prisma-next/sql-relational-core/expression';
import type { ExecutionContext } from '@prisma-next/sql-runtime';
import { createExecutionContext, createSqlExecutionStack } from '@prisma-next/sql-runtime';
import sqliteTarget, { SqliteContractSerializer } from '@prisma-next/target-sqlite/runtime';
import { blindCast } from '@prisma-next/utils/casts';
import { buildSqliteSurface } from './sqlite-surface';

type UnboundSql<TContract extends Contract<SqlStorage>> =
  Db<TContract>[typeof UNBOUND_NAMESPACE_ID];
type UnboundEnums<TContract extends Contract<SqlStorage>> =
  NamespacedEnums<TContract>[typeof UNBOUND_NAMESPACE_ID];

export interface SqliteStaticContext<TContract extends Contract<SqlStorage>> {
  readonly context: ExecutionContext<TContract>;
  readonly contract: TContract;
  readonly enums: UnboundEnums<TContract>;
  readonly sql: UnboundSql<TContract>;
  readonly raw: RawSqlTag;
}

export function buildSqliteStaticContext<TContract extends Contract<SqlStorage>>(
  contract: TContract,
): SqliteStaticContext<TContract> {
  const stack = createSqlExecutionStack({
    target: sqliteTarget,
    adapter: sqliteAdapter,
  });
  const context = createExecutionContext({ contract, stack });
  const { enums, sql: sqlDb, raw } = buildSqliteSurface(context, stack.adapter.rawCodecInferer);
  return { context, contract, enums, sql: sqlDb, raw };
}

export default function sqliteStatic<TContract extends Contract<SqlStorage>>(options: {
  readonly contractJson: unknown;
}): SqliteStaticContext<TContract> {
  const contract = blindCast<
    TContract,
    'SqliteContractSerializer validates and returns a typed contract'
  >(new SqliteContractSerializer().deserializeContract(options.contractJson));
  return buildSqliteStaticContext(contract);
}
