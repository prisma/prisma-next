import {
  freezeNode,
  NamespaceBase,
  UNBOUND_NAMESPACE_ID,
} from '@prisma-next/framework-components/ir';
import {
  createSqlEntryConstructionRegistry,
  dispatchEntriesToRegistry,
  type EntryFactory,
} from '@prisma-next/sql-contract/entry-construction-registry';
import type {
  SqlNamespaceEntries,
  SqlNamespaceTablesInput,
  StorageTable,
} from '@prisma-next/sql-contract/types';
import { blindCast } from '@prisma-next/utils/casts';

export type SqliteDatabaseInput = {
  readonly id: string;
  readonly entries: SqlNamespaceEntries;
};

// SQLite constructs only `table`; valueSet stays carried raw per spec.
// Build a table-only registry by passing no pack factories — we then
// filter to just the table entry so valueSet is NOT registered.
const _fullCoreRegistry = createSqlEntryConstructionRegistry();
const SQLITE_REGISTRY: ReadonlyMap<string, EntryFactory> = new Map(
  [..._fullCoreRegistry.entries()].filter(([k]) => k === 'table'),
);

const SQLITE_NAMESPACE_KIND = 'sqlite-namespace' as const;

/**
 * SQLite namespace concretion carrying table metadata under
 * `entries.table` and unqualified `qualifyTable()` emission for runtime
 * SQL rendering.
 */
export class SqliteDatabase extends NamespaceBase {
  declare readonly kind: string;

  readonly id: string;
  readonly entries: SqlNamespaceEntries;

  constructor(input: SqliteDatabaseInput) {
    super();
    this.id = input.id;

    const dispatched = dispatchEntriesToRegistry(
      blindCast<
        Record<string, Readonly<Record<string, unknown>>>,
        'SqliteDatabaseInput.entries values are plain record maps'
      >(input.entries),
      SQLITE_REGISTRY,
    );

    const table = blindCast<
      Readonly<Record<string, StorageTable>>,
      'SQLITE_REGISTRY constructs StorageTable for the table kind'
    >(dispatched['table'] ?? Object.freeze({}));
    const { table: _t, ...carried } = dispatched;

    this.entries = Object.freeze({ ...carried, table });
    Object.defineProperty(this, 'kind', {
      value: SQLITE_NAMESPACE_KIND,
      writable: false,
      enumerable: false,
      configurable: true,
    });
    freezeNode(this);
  }

  get table(): Readonly<Record<string, StorageTable>> {
    return this.entries.table ?? Object.freeze({});
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
  if (input.id !== UNBOUND_NAMESPACE_ID) {
    throw new Error(
      `buildSqliteNamespace: SQLite has no schema concept; the only valid namespace id is "${UNBOUND_NAMESPACE_ID}" (received "${input.id}").`,
    );
  }
  const tableKind = input.entries['table'];
  const tableCount = tableKind !== undefined ? Object.keys(tableKind).length : 0;
  const hasUnknownKinds = Object.keys(input.entries).some((kind) => kind !== 'table');
  if (tableCount === 0 && !hasUnknownKinds) {
    return SqliteUnboundDatabase.instance;
  }
  return new SqliteDatabase({ id: input.id, entries: input.entries });
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
