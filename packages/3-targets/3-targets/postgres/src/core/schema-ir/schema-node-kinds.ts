/**
 * The `nodeKind` discriminant for each Postgres schema-diff node. Each node
 * carries a unique value; the `.is`/`.assert`/`.ensure` guards compare against
 * these identifiers rather than spelling the string inline. The field is an
 * enumerable own property, so it survives the `projectSchemaToSpace` spread that
 * flattens the tree into plain objects.
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
