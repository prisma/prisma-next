import {
  freezeNode,
  type Namespace,
  NamespaceBase,
  UNBOUND_NAMESPACE_ID,
} from '@prisma-next/framework-components/ir';
import { type SqlNamespaceTablesInput, StorageTable } from '@prisma-next/sql-contract/types';
import { castAs } from '@prisma-next/utils/casts';

export type SqliteDatabaseInput = {
  readonly id: string;
  readonly entries: {
    readonly table: Readonly<Record<string, StorageTable>>;
  };
};

const SQLITE_NAMESPACE_KIND = 'sqlite-namespace' as const;

function freezeSqliteTableEntries(
  input: SqlNamespaceTablesInput['entries'],
): SqliteDatabase['entries'] {
  return Object.freeze({
    table: Object.freeze(
      Object.fromEntries(
        Object.entries(input?.table ?? {}).map(([name, t]) => [
          name,
          t instanceof StorageTable ? t : new StorageTable(t),
        ]),
      ),
    ),
  });
}

function isMaterializedSqliteNamespace(
  ns: Namespace | SqlNamespaceTablesInput,
): ns is SqliteDatabase | SqliteUnboundDatabase {
  if (typeof ns !== 'object' || ns === null) {
    return false;
  }
  const proto = Object.getPrototypeOf(ns);
  if (proto === Object.prototype || proto === null) {
    return false;
  }
  return (ns as { kind?: unknown }).kind === SQLITE_NAMESPACE_KIND;
}

/**
 * SQLite namespace concretion carrying table metadata under
 * `entries.table` and unqualified `qualifyTable()` emission for runtime
 * SQL rendering.
 */
export class SqliteDatabase extends NamespaceBase {
  declare readonly kind: string;

  readonly id: string;
  readonly entries: Readonly<{
    readonly table: Readonly<Record<string, StorageTable>>;
  }>;

  constructor(input: SqliteDatabaseInput) {
    super();
    this.id = input.id;
    this.entries = freezeSqliteTableEntries(input.entries);
    Object.defineProperty(this, 'kind', {
      value: SQLITE_NAMESPACE_KIND,
      writable: false,
      enumerable: false,
      configurable: true,
    });
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
export class SqliteUnboundDatabase extends SqliteDatabase {
  static readonly instance: SqliteUnboundDatabase = new SqliteUnboundDatabase();

  private constructor() {
    super({ id: UNBOUND_NAMESPACE_ID, entries: { table: {} } });
  }
}

export function buildSqliteNamespace(
  input: SqlNamespaceTablesInput,
): SqliteDatabase | SqliteUnboundDatabase {
  const tableCount = Object.keys(input.entries?.table ?? {}).length;
  if (input.id === UNBOUND_NAMESPACE_ID && tableCount === 0) {
    return castAs<SqliteUnboundDatabase>(SqliteUnboundDatabase.instance);
  }
  if (input.id !== UNBOUND_NAMESPACE_ID) {
    throw new Error(
      `buildSqliteNamespace: SQLite has no schema concept; the only valid namespace id is "${UNBOUND_NAMESPACE_ID}" (received "${input.id}").`,
    );
  }
  return new SqliteDatabase({
    id: input.id,
    entries: freezeSqliteTableEntries(input.entries),
  });
}

export function buildSqliteNamespaceMap(
  namespaces: Readonly<Record<string, Namespace | SqlNamespaceTablesInput>>,
): Readonly<Record<string, SqliteDatabase | SqliteUnboundDatabase>> {
  return Object.fromEntries(
    Object.entries(namespaces).map(([nsKey, ns]) => [
      nsKey,
      isMaterializedSqliteNamespace(ns) ? ns : buildSqliteNamespace(ns),
    ]),
  );
}

/**
 * Target-supplied `Namespace` factory the SQLite target plumbs through
 * `defineContract({ createNamespace })`. SQLite has only one
 * effective namespace slot — the framework `UNBOUND_NAMESPACE_ID`
 * sentinel — so the factory always returns the singleton or a fresh
 * `SqliteDatabase` for the unbound slot with tables. The SQL family's
 * defensive validation in `defineContract` already rejects
 * user-declared SQLite namespaces, so this throw is a structural
 * safety net rather than a user-facing surface.
 */
export function sqliteCreateNamespace(
  input: SqlNamespaceTablesInput,
): SqliteDatabase | SqliteUnboundDatabase {
  return buildSqliteNamespace(input);
}
