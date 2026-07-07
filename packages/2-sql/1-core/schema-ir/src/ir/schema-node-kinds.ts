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
