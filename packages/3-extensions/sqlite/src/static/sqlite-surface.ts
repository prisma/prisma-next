import { buildNamespacedEnums, type NamespacedEnums } from '@prisma-next/contract/enum-accessor';
import type { Contract } from '@prisma-next/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { sql } from '@prisma-next/sql-builder/runtime';
import type { Db } from '@prisma-next/sql-builder/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { RawCodecInferer, RawSqlTag } from '@prisma-next/sql-relational-core/expression';
import { createRawSql } from '@prisma-next/sql-relational-core/expression';
import type { ExecutionContext } from '@prisma-next/sql-runtime';
import { blindCast } from '@prisma-next/utils/casts';

type UnboundSql<TContract extends Contract<SqlStorage>> =
  Db<TContract>[typeof UNBOUND_NAMESPACE_ID];
type UnboundEnums<TContract extends Contract<SqlStorage>> =
  NamespacedEnums<TContract>[typeof UNBOUND_NAMESPACE_ID];

export interface SqliteSurface<TContract extends Contract<SqlStorage>> {
  readonly enums: UnboundEnums<TContract>;
  readonly sql: UnboundSql<TContract>;
  readonly raw: RawSqlTag;
}

/**
 * Derives the query surface (`enums`, `sql`, `raw`) from an already-built
 * {@link ExecutionContext}. Shared by the client-safe static builder and the
 * full runtime facade so the enum `blindCast` lives in exactly one place
 * regardless of which stack (driverless vs. driver+extensions) built the context.
 */
export function buildSqliteSurface<TContract extends Contract<SqlStorage>>(
  context: ExecutionContext<TContract>,
  rawCodecInferer: RawCodecInferer,
): SqliteSurface<TContract> {
  const sqlDb = blindCast<
    UnboundSql<TContract>,
    'the unbound namespace always exists on a sqlite builder output'
  >(sql<TContract>({ context, rawCodecInferer })[UNBOUND_NAMESPACE_ID]);
  const raw: RawSqlTag = createRawSql(rawCodecInferer);
  const enums = blindCast<
    UnboundEnums<TContract>,
    'the unbound namespace always exists on a sqlite builder output'
  >(Object.freeze(buildNamespacedEnums(context.contract.domain))[UNBOUND_NAMESPACE_ID]);
  return { enums, sql: sqlDb, raw };
}
