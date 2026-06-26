import type { Contract } from '@prisma-next/contract/types';
import {
  buildSqlSingleNamespaceView,
  type SqlSingleNamespaceViewShape,
} from '@prisma-next/sql-contract/contract-view';
import type { SqlStorage } from '@prisma-next/sql-contract/types';

export type SqliteContractViewShape<TContract extends Contract<SqlStorage>> =
  SqlSingleNamespaceViewShape<TContract>;

/**
 * A read-only view over a deserialized SQLite contract that unwraps the single
 * default namespace and promotes the SQL built-in kinds to the top level.
 *
 * Usage:
 * ```ts
 * const cv = SqliteContractView.from(endContract);
 * cv.table.users        // typed table leaf
 * cv.entries.policy.X   // pack-contributed kind (singular key)
 * ```
 *
 * SQLite has `sql.enums: false`, so it never emits `valueSet` entries; the
 * `valueSet` slot is therefore an empty map. The `Contract` type is unchanged —
 * this view is a separate object layered on top, reusing the generic
 * single-namespace projection.
 */
export class SqliteContractView {
  private constructor() {}

  static from<TContract extends Contract<SqlStorage>>(
    contract: TContract,
  ): SqliteContractViewShape<TContract> {
    return buildSqlSingleNamespaceView(contract);
  }
}
