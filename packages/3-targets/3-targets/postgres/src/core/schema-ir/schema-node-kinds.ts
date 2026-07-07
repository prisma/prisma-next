import type { DiffableNode } from '@prisma-next/framework-components/control';
import type { SqlSchemaIRNode } from '@prisma-next/sql-schema-ir/types';

/**
 * A Postgres schema-diff-tree node: a `SqlSchemaIRNode` that also implements
 * `DiffableNode` (the five `Postgres*SchemaNode` classes). `SqlSchemaIRNode`
 * alone is not a `DiffableNode` — its relational subclasses (`SqlColumnIR`, …)
 * carry no `id`/`isEqualTo`/`children` — so this intersection is the honest node
 * type the differ produces and the planner consumes (`SchemaDiff<SqlSchemaDiffNode>`).
 */
export type SqlSchemaDiffNode = SqlSchemaIRNode & DiffableNode;

/**
 * The `nodeKind` discriminant for each Postgres schema-diff node. Each node
 * carries a unique value; the static `is`/`assert` guards compare against these
 * identifiers rather than spelling the string inline or using `instanceof`. The
 * field is an enumerable own property carried on every node instance.
 */
export const PostgresSchemaNodeKind = {
  database: 'postgres-database',
  namespace: 'postgres-namespace',
  table: 'postgres-table',
  policy: 'postgres-policy',
  role: 'postgres-role',
} as const;

export type PostgresSchemaNodeKind =
  (typeof PostgresSchemaNodeKind)[keyof typeof PostgresSchemaNodeKind];
