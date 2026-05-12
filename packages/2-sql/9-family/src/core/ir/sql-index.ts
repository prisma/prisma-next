import { SqlNode } from './sql-node';

/**
 * SQL family secondary-index IR base. Carries the column list every
 * index is defined over and the uniqueness bit. Targets add dialect
 * specifics (Postgres carries an index method — btree, gin, gist,
 * brin — and partial-index `WHERE` predicates; SQLite carries its own
 * partial-index shape).
 */
export abstract class SqlIndex extends SqlNode {
  abstract readonly columns: readonly string[];
  abstract readonly unique: boolean;
}
