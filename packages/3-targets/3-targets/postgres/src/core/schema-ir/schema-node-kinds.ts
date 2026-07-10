import type {
  DiffableNode,
  DiffSubjectGranularity,
} from '@prisma-next/framework-components/control';
import {
  relationalNodeEntityKind,
  relationalNodeGranularity,
  type SqlSchemaIRNode,
} from '@prisma-next/sql-schema-ir/types';

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
  nativeEnum: 'postgres-native-enum',
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
    [PostgresSchemaNodeKind.nativeEnum]: 'entity',
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

/**
 * The one real map from a Postgres-specific `nodeKind` to its storage
 * `entityKind` — the same vocabulary the contract storage's `entries`
 * dictionary keys use. Only the whole-table kind has an entity of its own;
 * database/namespace/policy/role nodes map to nothing here (a namespace is
 * addressed by id, not by an `entries` kind; policies and roles are
 * structural, never a sibling space's unclaimed entity).
 */
const POSTGRES_NODE_ENTITY_KIND: Partial<Readonly<Record<PostgresSchemaNodeKind, string>>> = {
  [PostgresSchemaNodeKind.table]: 'table',
};

/** Looks up the storage entityKind for a Postgres-specific `nodeKind`. */
export function postgresNodeEntityKind(nodeKind: PostgresSchemaNodeKind): string | undefined {
  return POSTGRES_NODE_ENTITY_KIND[nodeKind];
}

/**
 * The storage `entityKind` for any node kind that appears in a Postgres diff
 * tree — sibling of {@link postgresDiffSubjectGranularity}, dispatching the
 * same way to whichever family/target map owns the kind. Called on demand by
 * the framework aggregate's unclaimed-elements sweep via the {@link
 * import('@prisma-next/framework-components/control').SchemaSubjectClassifierCapable}
 * capability — never stamped onto the issue or the node.
 */
export function postgresDiffSubjectEntityKind(nodeKind: string): string | undefined {
  return isPostgresSchemaNodeKind(nodeKind)
    ? postgresNodeEntityKind(nodeKind)
    : relationalNodeEntityKind(nodeKind);
}

/**
 * Whether a paired `not-equal` diff issue on this Postgres node kind
 * describes value-set drift (the `valueDrift` verifier category) rather than
 * declared-shape incompatibility. A native enum's only pairable divergence
 * is its ordered member values — the same semantics the check-constraint
 * value-set carries at the relational layer — so `external` suppresses the
 * drift while `managed` fails it.
 */
export function postgresValueDriftNodeKind(nodeKind: string): boolean {
  return nodeKind === PostgresSchemaNodeKind.nativeEnum;
}
