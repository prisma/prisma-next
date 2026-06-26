import type { Contract } from '@prisma-next/contract/types';
import {
  buildSqlSchemaQualifiedView,
  type SqlSchemaQualifiedViewShape,
} from '@prisma-next/sql-contract/contract-view';
import type { SqlStorage } from '@prisma-next/sql-contract/types';

export type PostgresContractViewShape<TContract extends Contract<SqlStorage>> =
  SqlSchemaQualifiedViewShape<TContract>;

/**
 * A read-only, schema-qualified view over a deserialized Postgres contract.
 * Postgres has named schemas (`public`, `auth`, …) plus the default
 * `__unbound__` schema, so the view qualifies by schema first, then applies the
 * SQL kind split per schema:
 *
 * ```ts
 * const cv = PostgresContractView.from(endContract);
 * cv.public.table.users        // typed table leaf in the public schema
 * cv.auth.table.users          // the auth schema's own users table
 * cv.public.entries.policy.X   // pack-contributed kind (RLS / #771 path)
 * cv.__unbound__.table.X       // default schema, keyed by its raw id
 * ```
 *
 * The schema keys mirror the facade's `sql.<ns>` keying exactly — the default
 * schema is reachable under its literal `__unbound__` id, with no renaming.
 * Each schema is its own key; there is no flat cross-namespace merge. The
 * `Contract` type is unchanged — this view is a separate object layered on top.
 */
export class PostgresContractView {
  private constructor() {}

  static from<TContract extends Contract<SqlStorage>>(
    contract: TContract,
  ): PostgresContractViewShape<TContract> {
    return buildSqlSchemaQualifiedView(contract);
  }
}
