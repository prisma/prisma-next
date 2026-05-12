import { SqlNode } from './sql-node';

/**
 * SQL family unique-constraint IR base. Carries the constrained column
 * list. Targets add dialect-specific predicate / expression / partial
 * shapes (e.g. Postgres partial unique indexes via `WHERE`).
 */
export abstract class SqlUnique extends SqlNode {
  abstract readonly columns: readonly string[];
}
