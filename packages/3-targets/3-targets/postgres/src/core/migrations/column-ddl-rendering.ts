import type { CodecControlHooks } from '@prisma-next/family-sql/control';
import type { StorageColumn } from '@prisma-next/sql-contract/types';
import type { DdlColumn } from '@prisma-next/sql-relational-core/ast';
import * as contractFree from '@prisma-next/sql-relational-core/contract-free';
import type { SqlColumnDefaultIR, SqlColumnIR } from '@prisma-next/sql-schema-ir/types';
import { blindCast } from '@prisma-next/utils/casts';
import { ifDefined } from '@prisma-next/utils/defined';
import { postgresDefaultToDdlColumnDefault } from './op-factory-call';
import { buildColumnDefaultSql, buildColumnTypeSql } from './planner-ddl-builders';
import { resolveIdentityValue } from './planner-identity-values';
import { buildExpectedFormatType } from './planner-sql-checks';

/**
 * Reconstructs the `StorageColumn`-shaped fields the DDL builder functions
 * (`buildColumnTypeSql`, `buildExpectedFormatType`, `resolveIdentityValue`)
 * expect, from a column node's own stamped codec identity (`codecRef` /
 * `codecBaseNativeType` / `codecNamedType`, Decision 5) — never the
 * contract. The builders were written against `StorageColumn` and are
 * unchanged here; only the shape feeding them moves from the contract to
 * the node. An empty `storageTypes` catalog is passed alongside: the
 * node's fields are already resolved past any `typeRef` indirection, so no
 * live lookup is needed, and passing a non-empty catalog would risk a
 * false `typeRef` hit against an unrelated storage type.
 */
function columnLike(
  column: SqlColumnIR,
): Pick<
  StorageColumn,
  'nativeType' | 'codecId' | 'nullable' | 'many' | 'typeParams' | 'typeRef' | 'default'
> {
  if (column.codecRef === undefined || column.codecBaseNativeType === undefined) {
    throw new Error(
      `columnLike: expected column "${column.name}" carries no codec identity — the expected tree must be derived via contractToSchemaIR for planning`,
    );
  }
  return {
    nativeType: column.codecBaseNativeType,
    codecId: column.codecRef.codecId,
    nullable: column.nullable,
    // `column.many` is unset on contract-derived columns (array-ness rides
    // on the `nativeType` `[]` suffix there instead) — `codecRef.many`
    // carries it. Hand-built/introspected columns set `column.many` directly.
    ...ifDefined('many', column.many ?? column.codecRef.many),
    ...ifDefined(
      'typeParams',
      column.codecRef.typeParams !== undefined
        ? blindCast<
            Record<string, unknown>,
            'CodecRef.typeParams is JsonValue-shaped; the DDL builders only ever read it as the Record the contract column originally carried'
          >(column.codecRef.typeParams)
        : undefined,
    ),
    ...(column.codecNamedType ? { typeRef: '<resolved>' } : {}),
    ...ifDefined('default', column.resolvedDefault),
  };
}

/**
 * Builds the `CREATE TABLE` / `ADD COLUMN` DDL column for an expected column
 * node, resolving type rendering from the node's codec identity against the
 * codec hooks the caller holds — the same builder the pre-`plan(start, end)`
 * op-path called, so the output is byte-identical.
 */
export function renderColumnDdl(
  name: string,
  column: SqlColumnIR,
  codecHooks: ReadonlyMap<string, CodecControlHooks>,
): DdlColumn {
  const like = columnLike(column);
  const typeSql = buildColumnTypeSql(like, codecHooks, {});
  const ddlDefault = postgresDefaultToDdlColumnDefault(like.default);
  return contractFree.col(name, typeSql, {
    ...(!column.nullable ? { notNull: true } : {}),
    ...ifDefined('default', ddlDefault),
    ...ifDefined('codecRef', column.codecRef),
  });
}

/**
 * Builds the `ALTER COLUMN … TYPE` operands for an expected column node.
 */
export function renderColumnAlterType(
  column: SqlColumnIR,
  codecHooks: ReadonlyMap<string, CodecControlHooks>,
): { readonly qualifiedTargetType: string; readonly formatTypeExpected: string } {
  const like = columnLike(column);
  return {
    qualifiedTargetType: buildColumnTypeSql(like, codecHooks, {}, false),
    formatTypeExpected: buildExpectedFormatType(like, codecHooks, {}),
  };
}

/**
 * Resolves the identity value (monoid neutral element) SQL literal used as
 * the temporary default when adding a NOT-NULL column with no contract
 * default (`notNullAddColumnCallStrategy`'s shared-temp-default backfill).
 * `null` when the column's type has no built-in/codec-provided identity
 * value.
 */
export function resolveColumnTemporaryDefault(
  column: SqlColumnIR,
  codecHooks: ReadonlyMap<string, CodecControlHooks>,
): string | null {
  return resolveIdentityValue(columnLike(column), codecHooks, {});
}

/**
 * The column's `SET DEFAULT` clause SQL, resolved from a column-default
 * diff node. `''` when the node carries no resolved default.
 */
export function renderColumnDefaultSql(defaultNode: SqlColumnDefaultIR): string {
  if (defaultNode.resolved === undefined) return '';
  return buildColumnDefaultSql(defaultNode.resolved, {
    nativeType: defaultNode.nativeTypeContext ?? '',
    ...ifDefined('many', defaultNode.many),
  });
}
