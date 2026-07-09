import type {
  DiffableNode,
  DiffSubjectGranularity,
} from '@prisma-next/framework-components/control';
import { relationalNodeGranularity, type SqlSchemaIRNode } from '@prisma-next/sql-schema-ir/types';

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

/**
 * The one real map from a Postgres-specific `nodeKind` to the
 * framework-neutral {@link DiffSubjectGranularity} its diff issues carry —
 * resolution is by `nodeKind` equality against this map, never a
 * `nodeKind`-suffix string match and never anything stamped on the node.
 */
const POSTGRES_NODE_GRANULARITY: Readonly<Record<PostgresSchemaNodeKind, DiffSubjectGranularity>> =
  {
    [PostgresSchemaNodeKind.database]: 'structural',
    [PostgresSchemaNodeKind.namespace]: 'namespace',
    [PostgresSchemaNodeKind.table]: 'entity',
    [PostgresSchemaNodeKind.policy]: 'structural',
    [PostgresSchemaNodeKind.role]: 'structural',
  };

function isPostgresSchemaNodeKind(nodeKind: string): nodeKind is PostgresSchemaNodeKind {
  return Object.hasOwn(POSTGRES_NODE_GRANULARITY, nodeKind);
}

/** Looks up the subject granularity for a Postgres-specific `nodeKind`. */
export function postgresNodeGranularity(nodeKind: PostgresSchemaNodeKind): DiffSubjectGranularity {
  return POSTGRES_NODE_GRANULARITY[nodeKind];
}

/**
 * The subject granularity for any node kind that appears in a Postgres diff
 * tree — the tree mixes Postgres-specific kinds (database/namespace/table/
 * policy/role) with the relational leaf kinds (columns, constraints, indexes,
 * …), so this dispatches to whichever family/target map owns the kind. Called
 * on demand by consumers (the family verdict, the framework aggregate's
 * unclaimed-elements sweep, via the {@link
 * import('@prisma-next/framework-components/control').SchemaSubjectClassifierCapable}
 * capability) — never stamped onto the issue or the node.
 */
export function postgresDiffSubjectGranularity(nodeKind: string): DiffSubjectGranularity {
  return isPostgresSchemaNodeKind(nodeKind)
    ? postgresNodeGranularity(nodeKind)
    : relationalNodeGranularity(nodeKind);
}
