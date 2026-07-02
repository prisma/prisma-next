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
