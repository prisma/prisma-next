import { SqlNode } from './sql-node';

/**
 * SQL family column IR base. Concrete target columns (e.g. `PostgresColumn`,
 * `SqliteColumn`) extend this class and add target-specific fields
 * (Postgres carries `nativeType`, default-rendering specifics; SQLite
 * carries SQLite's affinity model, etc.).
 *
 * Commits to the family-shape contract: every SQL column has a `name`, a
 * nullability bit, and (where applicable) a default expression. The
 * `nativeType` field is target-specific and stays at the target level —
 * different SQL dialects spell types differently (`text` vs `TEXT` vs
 * `character varying`) and this layer is the wrong place to canonicalize.
 */
export abstract class SqlColumn extends SqlNode {
  abstract readonly name: string;
  abstract readonly nullable: boolean;
}
