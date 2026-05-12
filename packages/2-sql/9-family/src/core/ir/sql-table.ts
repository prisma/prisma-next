import { SqlNode } from './sql-node';

/**
 * SQL family table IR base. Commits to the family-shape contract: every
 * SQL table has a name and lives in a namespace. Concrete subclasses
 * carry the columns / primary key / FKs / uniques / indexes maps; the
 * exact element types are target-specific (a `PostgresTable` carries
 * `Record<string, PostgresColumn>`, a `SqliteTable` carries
 * `Record<string, SqliteColumn>`), so they're declared on the
 * concretions rather than constrained to a family-level type here.
 *
 * The `(namespace.id, name)` keying that the verifier and planner depend
 * on is reachable from this base via `(table.namespaceId, table.name)`.
 */
export abstract class SqlTable extends SqlNode {
  abstract readonly name: string;
  abstract readonly namespaceId: string;
}
