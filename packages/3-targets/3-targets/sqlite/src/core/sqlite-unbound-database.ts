import {
  freezeNode,
  NamespaceBase,
  UNBOUND_NAMESPACE_ID,
} from '@prisma-next/framework-components/ir';

/**
 * SQLite target `Namespace` concretion. SQLite has no schema or
 * database-namespacing concept at the SQL level — there is exactly one
 * effective namespace per connection, so the target ships a single
 * singleton bound to the framework's `UNBOUND_NAMESPACE_ID` slot.
 *
 * Qualifier emission elides the prefix entirely: rendered DDL and
 * queries look unqualified (`CREATE TABLE "users" (...)`), matching
 * SQLite's native dialect. Call sites stay polymorphic — they ask the
 * namespace for its qualifier and consume the empty/unqualified result
 * the same way Postgres consumes a `"schema"` prefix.
 *
 * The SQLite PSL interpreter rejects every explicit `namespace { … }`
 * block with a diagnostic naming SQLite; only the implicit
 * `__unspecified__` AST bucket reaches the SQLite interpreter, which
 * lowers it to this singleton.
 */
export class SqliteUnboundDatabase extends NamespaceBase {
  static readonly instance: SqliteUnboundDatabase = new SqliteUnboundDatabase();

  readonly kind = 'database' as const;
  readonly id = UNBOUND_NAMESPACE_ID;

  private constructor() {
    super();
    freezeNode(this);
  }

  qualifier(): string {
    return '';
  }

  qualifyTable(tableName: string): string {
    return `"${tableName}"`;
  }
}
