import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import { buildNamespacedEnums, type NamespacedEnums } from '@prisma-next/contract/enum-accessor';
import type { Contract } from '@prisma-next/contract/types';
import { sql } from '@prisma-next/sql-builder/runtime';
import type { Db } from '@prisma-next/sql-builder/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { RawCodecInferer, RawSqlTag } from '@prisma-next/sql-relational-core/expression';
import { createRawSql } from '@prisma-next/sql-relational-core/expression';
import type { ExecutionContext, SqlRuntimeExtensionDescriptor } from '@prisma-next/sql-runtime';
import { createExecutionContext, createSqlExecutionStack } from '@prisma-next/sql-runtime';
import postgresTarget, { PostgresContractSerializer } from '@prisma-next/target-postgres/runtime';
import { blindCast } from '@prisma-next/utils/casts';
import { buildNamespacedNativeEnums, type NamespacedNativeEnums } from '../runtime/native-enums';
import type { PostgresTargetId } from '../runtime/postgres';

export interface PostgresStaticContext<TContract extends Contract<SqlStorage>> {
  readonly context: ExecutionContext<TContract>;
  readonly contract: TContract;
  readonly enums: NamespacedEnums<TContract>;
  readonly nativeEnums: NamespacedNativeEnums<TContract>;
  readonly sql: Db<TContract>;
  readonly raw: RawSqlTag;
}

export function buildPostgresStaticContext<TContract extends Contract<SqlStorage>>(
  context: ExecutionContext<TContract>,
  rawCodecInferer: RawCodecInferer,
): PostgresStaticContext<TContract> {
  const sqlDb: Db<TContract> = sql<TContract>({ context, rawCodecInferer });
  const raw: RawSqlTag = createRawSql(rawCodecInferer);
  const enums = Object.freeze(buildNamespacedEnums<TContract>(context.contract.domain));
  const nativeEnums = blindCast<
    NamespacedNativeEnums<TContract>,
    'buildNamespacedNativeEnums returns the namespace-keyed accessor map this contract types'
  >(Object.freeze(buildNamespacedNativeEnums(context.contract.storage)));
  return { context, contract: context.contract, enums, nativeEnums, sql: sqlDb, raw };
}

export default function postgresStatic<TContract extends Contract<SqlStorage>>(options: {
  readonly contractJson: unknown;
  readonly extensions?: readonly SqlRuntimeExtensionDescriptor<PostgresTargetId>[];
}): PostgresStaticContext<TContract> {
  const contract = blindCast<
    TContract,
    'PostgresContractSerializer validates and returns a typed contract'
  >(new PostgresContractSerializer().deserializeContract(options.contractJson));
  const stack = createSqlExecutionStack({
    target: postgresTarget,
    adapter: postgresAdapter,
    extensions: options.extensions ?? [],
  });
  const context = createExecutionContext({ contract, stack });
  return buildPostgresStaticContext(context, stack.adapter.rawCodecInferer);
}
