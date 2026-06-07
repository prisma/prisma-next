import type { SqlMigrationPlanOperation } from '@prisma-next/family-sql/control';
import type { ReferentialAction } from '@prisma-next/sql-contract/types';
import { ifDefined } from '@prisma-next/utils/defined';
import { quoteIdentifier } from '../../sql-utils';
import type { PostgresColumnDefault } from '../../types';
import type { OperationClass, PostgresPlanTargetDetails } from '../planner-target-details';

export type Op = SqlMigrationPlanOperation<PostgresPlanTargetDetails>;

/**
 * Literal-args shape for a column definition consumed by `createTable` and
 * `addColumn`. Fully materialized: codec expansion and default rendering have
 * already happened in the wrapper.
 *
 * - `typeSql` is the column's DDL type string (e.g. `"integer"`, `"SERIAL"`,
 *   `"varchar(100)"`), already produced by `buildColumnTypeSql` in the
 *   call-factory wrapper.
 * - `defaultSql` is the full `DEFAULT …` clause (e.g. `"DEFAULT 42"`) or an
 *   empty string when the column has no default, matching
 *   `buildColumnDefaultSql`'s output.
 * - `columnDefault` is the structured default, used by the DDL AST lowering
 *   path to build `DdlColumnDefault` nodes without re-parsing `defaultSql`.
 */
export interface ColumnSpec {
  readonly name: string;
  readonly typeSql: string;
  readonly defaultSql: string;
  readonly columnDefault: PostgresColumnDefault | undefined;
  readonly nullable: boolean;
}

/**
 * Literal-args shape for a foreign key definition. `references.schema`
 * carries the target table's namespace (schema) coordinate so the rendered
 * DDL qualifies the REFERENCES clause correctly for cross-schema FKs.
 */
export interface ForeignKeySpec {
  readonly name: string;
  readonly columns: readonly string[];
  readonly references: {
    readonly schema: string;
    readonly table: string;
    readonly columns: readonly string[];
  };
  readonly onDelete?: ReferentialAction;
  readonly onUpdate?: ReferentialAction;
}

export function step(description: string, sql: string) {
  return { description, sql };
}

export function targetDetails(
  objectType: OperationClass,
  name: string,
  schema: string,
  table?: string,
): { readonly id: 'postgres'; readonly details: PostgresPlanTargetDetails } {
  return {
    id: 'postgres',
    details: { schema, objectType, name, ...ifDefined('table', table) },
  };
}

export function renderColumnDefinition(column: ColumnSpec): string {
  const parts = [
    quoteIdentifier(column.name),
    column.typeSql,
    column.defaultSql,
    column.nullable ? '' : 'NOT NULL',
  ].filter(Boolean);
  return parts.join(' ');
}
