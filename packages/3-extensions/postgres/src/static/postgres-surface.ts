import { buildNamespacedEnums, type NamespacedEnums } from '@prisma-next/contract/enum-accessor';
import type { Contract } from '@prisma-next/contract/types';
import { sql } from '@prisma-next/sql-builder/runtime';
import type { Db } from '@prisma-next/sql-builder/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { RawCodecInferer, RawSqlTag } from '@prisma-next/sql-relational-core/expression';
import { createRawSql } from '@prisma-next/sql-relational-core/expression';
import type { ExecutionContext } from '@prisma-next/sql-runtime';
import { blindCast } from '@prisma-next/utils/casts';

export interface PostgresSurface<TContract extends Contract<SqlStorage>> {
  readonly enums: NamespacedEnums<TContract>;
  readonly sql: Db<TContract>;
  readonly raw: RawSqlTag;
}

/**
 * Derives the query surface (`enums`, `sql`, `raw`) from an already-built
 * {@link ExecutionContext}. Shared by the client-safe static builder and the
 * full runtime facade so the enum `blindCast` lives in exactly one place
 * regardless of which stack (driverless vs. driver+extensions) built the context.
 */
export function buildPostgresSurface<TContract extends Contract<SqlStorage>>(
  context: ExecutionContext<TContract>,
  rawCodecInferer: RawCodecInferer,
): PostgresSurface<TContract> {
  const sqlDb: Db<TContract> = sql<TContract>({ context, rawCodecInferer });
  const raw: RawSqlTag = createRawSql(rawCodecInferer);
  const enums = blindCast<
    NamespacedEnums<TContract>,
    'buildNamespacedEnums returns the namespace-keyed accessor map this contract types'
  >(Object.freeze(buildNamespacedEnums(context.contract.domain)));
  return { enums, sql: sqlDb, raw };
}
