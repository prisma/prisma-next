/**
 * The `nodeKind` discriminant for each relational schema-diff leaf node.
 * Each node carries a unique value; the differ pairs siblings by `id`, and
 * these kinds distinguish the node types that appear as `PostgresTableSchemaNode`
 * children (columns, primary key, foreign keys, uniques, indexes, checks) from
 * each other and from the RLS policy/role kinds a target defines separately.
 */
export const RelationalSchemaNodeKind = {
  schema: 'sql-schema',
  table: 'sql-table',
  column: 'sql-column',
  columnDefault: 'sql-column-default',
  primaryKey: 'sql-primary-key',
  foreignKey: 'sql-foreign-key',
  unique: 'sql-unique',
  index: 'sql-index',
  check: 'sql-check-constraint',
} as const;

export type RelationalSchemaNodeKind =
  (typeof RelationalSchemaNodeKind)[keyof typeof RelationalSchemaNodeKind];

/**
 * Declared verdict-classification role of a schema-diff node — the
 * discriminant the SQL family's post-diff filters key on (issue category
 * and strict-mode gating), independent of the node's `nodeKind` spelling:
 *
 * - `namespace` / `table`: extras are `extraTopLevelObject`, strict-only.
 * - `column`: extras are `extraNestedElement`, strict-only.
 * - `auxiliary`: constraints, indexes, defaults — extras are
 *   `extraAuxiliary`, strict-only.
 * - `structural`: tree roots and structurally-diffed leaves (RLS policies,
 *   roles) — extras fail in every mode; never strict-gated.
 */
export type SqlSchemaDiffRole = 'namespace' | 'table' | 'column' | 'auxiliary' | 'structural';

/**
 * The one real map from a relational `nodeKind` to its {@link SqlSchemaDiffRole}
 * — `SqlSchemaIRNode`'s `diffRole` getter dispatches on `nodeKind` equality
 * against this map (never a `nodeKind`-suffix string match). Target-specific
 * node kinds (Postgres namespace/table/policy/role) are outside this family
 * layer's vocabulary and declare their own role directly.
 */
const RELATIONAL_NODE_ROLES: Readonly<Record<RelationalSchemaNodeKind, SqlSchemaDiffRole>> = {
  [RelationalSchemaNodeKind.schema]: 'structural',
  [RelationalSchemaNodeKind.table]: 'table',
  [RelationalSchemaNodeKind.column]: 'column',
  [RelationalSchemaNodeKind.columnDefault]: 'auxiliary',
  [RelationalSchemaNodeKind.primaryKey]: 'auxiliary',
  [RelationalSchemaNodeKind.foreignKey]: 'auxiliary',
  [RelationalSchemaNodeKind.unique]: 'auxiliary',
  [RelationalSchemaNodeKind.index]: 'auxiliary',
  [RelationalSchemaNodeKind.check]: 'auxiliary',
};

function isRelationalSchemaNodeKind(nodeKind: string): nodeKind is RelationalSchemaNodeKind {
  return Object.hasOwn(RELATIONAL_NODE_ROLES, nodeKind);
}

/**
 * Looks up the declared role for a relational `nodeKind`. Throws for a
 * `nodeKind` outside this map (a target-specific kind, e.g. Postgres's
 * namespace/table/policy/role) — those declare `diffRole` directly rather
 * than through this family-level map.
 */
export function relationalNodeRole(nodeKind: string): SqlSchemaDiffRole {
  if (!isRelationalSchemaNodeKind(nodeKind)) {
    throw new Error(`relationalNodeRole: unrecognized relational node kind "${nodeKind}"`);
  }
  return RELATIONAL_NODE_ROLES[nodeKind];
}
