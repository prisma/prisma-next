import sqliteAdapter from '@prisma-next/adapter-sqlite/runtime';
import { buildNamespacedEnums, type NamespacedEnums } from '@prisma-next/contract/enum-accessor';
import type { Contract } from '@prisma-next/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { sql } from '@prisma-next/sql-builder/runtime';
import type { Db } from '@prisma-next/sql-builder/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { RawCodecInferer, RawSqlTag } from '@prisma-next/sql-relational-core/expression';
import { createRawSql } from '@prisma-next/sql-relational-core/expression';
import type { ExecutionContext } from '@prisma-next/sql-runtime';
import { createExecutionContext, createSqlExecutionStack } from '@prisma-next/sql-runtime';
import sqliteTarget, { SqliteContractSerializer } from '@prisma-next/target-sqlite/runtime';
import { assertDefined } from '@prisma-next/utils/assertions';
import { blindCast } from '@prisma-next/utils/casts';

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
  context: ExecutionContext<TContract>,
  rawCodecInferer: RawCodecInferer,
): SqliteStaticContext<TContract> {
  const sqlNamespace = sql<TContract>({ context, rawCodecInferer })[UNBOUND_NAMESPACE_ID];
  assertDefined(sqlNamespace, 'the unbound namespace always exists on a sqlite builder output');
  const sqlDb = blindCast<
    UnboundSql<TContract>,
    'Db<TContract> indexed by a literal key widens NsId to string; TableProxy is invariant in NsId via insert()/update() parameter positions, so the indexed-access type cannot be proven to match the literal-keyed Namespace without this cast'
  >(sqlNamespace);
  const raw: RawSqlTag = createRawSql(rawCodecInferer);
  const enums = Object.freeze(buildNamespacedEnums<TContract>(context.contract.domain))[
    UNBOUND_NAMESPACE_ID
  ];
  assertDefined(enums, 'the unbound namespace always exists on a sqlite builder output');
  return { context, contract: context.contract, enums, sql: sqlDb, raw };
}

export default function sqliteStatic<TContract extends Contract<SqlStorage>>(options: {
  readonly contractJson: unknown;
}): SqliteStaticContext<TContract> {
  const contract = blindCast<
    TContract,
    'SqliteContractSerializer validates and returns a typed contract'
  >(new SqliteContractSerializer().deserializeContract(options.contractJson));
  const stack = createSqlExecutionStack({
    target: sqliteTarget,
    adapter: sqliteAdapter,
  });
  const context = createExecutionContext({ contract, stack });
  return buildSqliteStaticContext(context, stack.adapter.rawCodecInferer);
}
