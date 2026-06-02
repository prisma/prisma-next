import {
  freezeNode,
  NamespaceBase,
  UNBOUND_NAMESPACE_ID,
} from '@prisma-next/framework-components/ir';
import type { StorageTable } from '@prisma-next/sql-contract/types';

export type SqliteDatabaseInput = {
  readonly id: string;
  readonly tables: Readonly<Record<string, StorageTable>>;
};

/**
 * SQLite namespace concretion carrying table metadata and unqualified
 * `qualifyTable()` emission for runtime SQL rendering.
 */
export class SqliteDatabase extends NamespaceBase {
  readonly kind = 'database' as const;
  readonly id: string;
  readonly tables: Readonly<Record<string, StorageTable>>;

  constructor(input: SqliteDatabaseInput) {
    super();
    this.id = input.id;
    this.tables = Object.freeze({ ...input.tables });
    freezeNode(this);
  }

  qualifier(): string {
    return '';
  }

  qualifyTable(tableName: string): string {
    return `"${tableName}"`;
  }
}

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
  readonly tables: Readonly<Record<string, StorageTable>>;

  private constructor() {
    super();
    this.tables = Object.freeze({});
    freezeNode(this);
  }

  qualifier(): string {
    return '';
  }

  qualifyTable(tableName: string): string {
    return `"${tableName}"`;
  }
}

/**
 * Target-supplied `Namespace` factory the SQLite target plumbs through
 * `defineContract({ createNamespace })`. SQLite has only one
 * effective namespace slot — the framework `UNBOUND_NAMESPACE_ID`
 * sentinel — so the factory always returns the singleton and rejects
 * any other coordinate. The SQL family's defensive validation in
 * `defineContract` already rejects user-declared SQLite namespaces, so
 * this throw is a structural safety net rather than a user-facing
 * surface.
 */
export function sqliteCreateNamespace(id: string): SqliteUnboundDatabase {
  if (id === UNBOUND_NAMESPACE_ID) {
    return SqliteUnboundDatabase.instance;
  }
  throw new Error(
    `sqliteCreateNamespace: SQLite has no schema concept; the only valid namespace id is "${UNBOUND_NAMESPACE_ID}" (received "${id}").`,
  );
}
