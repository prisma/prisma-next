import { SqlNode } from './sql-node';

/**
 * SQL family primary-key IR base. Carries the column list every SQL
 * primary key has; targets add dialect specifics (Postgres carries an
 * optional constraint name; SQLite handles `INTEGER PRIMARY KEY` as an
 * alias for `ROWID`, which the target layer disambiguates).
 */
export abstract class SqlPrimaryKey extends SqlNode {
  abstract readonly columns: readonly string[];
}
