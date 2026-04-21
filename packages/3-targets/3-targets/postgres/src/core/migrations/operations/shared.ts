import { quoteIdentifier } from '@prisma-next/adapter-postgres/control';
import type { SqlMigrationPlanOperation } from '@prisma-next/family-sql/control';
import type { ReferentialAction } from '@prisma-next/sql-contract/types';
import { ifDefined } from '@prisma-next/utils/defined';
import type { OperationClass, PostgresPlanTargetDetails } from '../planner-target-details';

export type Op = SqlMigrationPlanOperation<PostgresPlanTargetDetails>;

/**
 * Literal-args shape for a column definition consumed by `createTable` and
 * `addColumn`. Fully materialized: codec expansion and default rendering have
 * already happened in the wrapper.
 *
 * - `typeSql` is the column's DDL type string (e.g. `"integer"`, `"SERIAL"`,
 *   `"varchar(100)"`), already produced by `buildColumnTypeSql` in the
 *   descriptor-flow wrapper.
 * - `defaultSql` is the full `DEFAULT …` clause (e.g. `"DEFAULT 42"`) or an
 *   empty string when the column has no default, matching
 *   `buildColumnDefaultSql`'s output.
 */
export interface ColumnSpec {
  readonly name: string;
  readonly typeSql: string;
  readonly defaultSql: string;
  readonly nullable: boolean;
}

/**
 * Literal-args shape for a foreign key definition. The referenced table is
 * assumed to live in the same schema as the constrained table — this matches
 * the current descriptor-flow behavior.
 */
export interface ForeignKeySpec {
  readonly name: string;
  readonly columns: readonly string[];
  readonly references: {
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
