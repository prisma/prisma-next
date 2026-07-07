import type { CodecControlHooks } from '@prisma-next/family-sql/control';
import type { StorageColumn, StorageTypeInstance } from '@prisma-next/sql-contract/types';
import type { DdlColumn } from '@prisma-next/sql-relational-core/ast';
import type { SqlColumnIR } from '@prisma-next/sql-schema-ir/types';
import { blindCast } from '@prisma-next/utils/casts';
import { toDdlColumn } from './issue-planner';
import { buildColumnDefaultSql, buildColumnTypeSql } from './planner-ddl-builders';
import { resolveIdentityValue } from './planner-identity-values';
import { buildExpectedFormatType } from './planner-sql-checks';

/**
 * The Postgres op-render payload stamped on an expected column node at
 * contract→IR derivation (via the family `renderColumnOps` callback). It
 * carries the ALREADY-COMPUTED results the migration op-builders read: the
 * `CREATE TABLE` / `ADD COLUMN` DDL column, the `ALTER COLUMN … TYPE` operands,
 * and the `SET DEFAULT` SQL. Each is produced by the same builder the
 * pre-`plan(start, end)` op-path called, so reading it back yields
 * byte-identical DDL — the computation is relocated to derivation, never
 * re-run against node fields.
 */
export interface PostgresColumnOpRender {
  readonly ddlColumn: DdlColumn;
  readonly alterType: {
    readonly qualifiedTargetType: string;
    readonly formatTypeExpected: string;
  };
  /** `SET DEFAULT` clause SQL, or `''` when the column declares no default. */
  readonly setDefaultSql: string;
  /**
   * The resolved identity value (monoid neutral element) SQL literal used as
   * the temporary default when adding a NOT-NULL column with no contract
   * default (`notNullAddColumnCallStrategy`'s shared-temp-default backfill).
   * `null` when the column's type has no built-in/codec-provided identity
   * value. Computed here with the codec hooks in hand (`resolveIdentityValue`)
   * so the node-based strategy reads the decision off the node instead of the
   * contract.
   */
  readonly temporaryDefault: string | null;
}

/**
 * Computes the {@link PostgresColumnOpRender} for one contract column, binding
 * the codec hooks and storage types the caller holds at derivation time.
 */
export function buildPostgresColumnOpRender(
  name: string,
  column: StorageColumn,
  codecHooks: ReadonlyMap<string, CodecControlHooks>,
  storageTypes: Readonly<Record<string, StorageTypeInstance>>,
): PostgresColumnOpRender {
  const hooksMap = codecHooks as Map<string, CodecControlHooks>;
  const typesMap = storageTypes as Record<string, StorageTypeInstance>;
  return {
    ddlColumn: toDdlColumn(name, column, codecHooks, storageTypes),
    alterType: {
      qualifiedTargetType: buildColumnTypeSql(column, hooksMap, typesMap, false),
      formatTypeExpected: buildExpectedFormatType(column, hooksMap, typesMap),
    },
    setDefaultSql: column.default ? buildColumnDefaultSql(column.default, column) : '',
    temporaryDefault: resolveIdentityValue(column, hooksMap, typesMap),
  };
}

/**
 * Narrows an expected column node's opaque `opRender` payload back to its
 * {@link PostgresColumnOpRender}. The migration op-builders read the
 * derivation-computed DDL / alter-type / set-default forms verbatim from here,
 * so emitted DDL is byte-identical to the pre-`plan(start, end)` contract path.
 * Throws when the node carries no payload — the expected tree must be derived
 * with `renderColumnOps` threaded (`buildPostgresPlanDiff`) for planning.
 */
export function columnOpRenderOf(column: SqlColumnIR): PostgresColumnOpRender {
  if (column.opRender === undefined) {
    throw new Error(
      `columnOpRenderOf: expected column "${column.name}" carries no opRender payload — the expected tree must be derived with renderColumnOps threaded for planning`,
    );
  }
  return blindCast<
    PostgresColumnOpRender,
    'PostgresColumnOpRender is the only opRender shape postgres-column-op-render.ts stamps; the planner only ever reads it off expected columns produced by buildPostgresColumnOpRender'
  >(column.opRender);
}
