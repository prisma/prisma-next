import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import type { NamespacedEnums } from '@prisma-next/contract/enum-accessor';
import type { Contract } from '@prisma-next/contract/types';
import type { Db } from '@prisma-next/sql-builder/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { RawSqlTag } from '@prisma-next/sql-relational-core/expression';
import type { ExecutionContext } from '@prisma-next/sql-runtime';
import { createExecutionContext, createSqlExecutionStack } from '@prisma-next/sql-runtime';
import postgresTarget, { PostgresContractSerializer } from '@prisma-next/target-postgres/runtime';
import { blindCast } from '@prisma-next/utils/casts';
import { buildPostgresSurface } from './postgres-surface';

export interface PostgresStaticContext<TContract extends Contract<SqlStorage>> {
  readonly context: ExecutionContext<TContract>;
  readonly contract: TContract;
  readonly enums: NamespacedEnums<TContract>;
  readonly sql: Db<TContract>;
  readonly raw: RawSqlTag;
}

export function buildPostgresStaticContext<TContract extends Contract<SqlStorage>>(
  contract: TContract,
): PostgresStaticContext<TContract> {
  const stack = createSqlExecutionStack({
    target: postgresTarget,
    adapter: postgresAdapter,
  });
  const context = createExecutionContext({ contract, stack });
  const { enums, sql: sqlDb, raw } = buildPostgresSurface(context, stack.adapter.rawCodecInferer);
  return { context, contract, enums, sql: sqlDb, raw };
}

export default function postgresStatic<TContract extends Contract<SqlStorage>>(options: {
  readonly contractJson: unknown;
}): PostgresStaticContext<TContract> {
  const contract = blindCast<
    TContract,
    'PostgresContractSerializer validates and returns a typed contract'
  >(new PostgresContractSerializer().deserializeContract(options.contractJson));
  return buildPostgresStaticContext(contract);
}
