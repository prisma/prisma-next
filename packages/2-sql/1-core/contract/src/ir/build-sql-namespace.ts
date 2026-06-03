import {
  freezeNode,
  type Namespace,
  NamespaceBase,
  UNBOUND_NAMESPACE_ID,
} from '@prisma-next/framework-components/ir';
import { blindCast, castAs } from '@prisma-next/utils/casts';
import type { PostgresEnumStorageEntry } from './postgres-enum-storage-entry';
import type { SqlNamespace, SqlNamespaceTablesInput } from './sql-storage';
import { SqlUnboundNamespace } from './sql-unbound-namespace';
import { StorageTable } from './storage-table';

const SQL_NAMESPACE_KIND = 'sql-namespace' as const;

function isMaterializedSqlNamespace(ns: Namespace | SqlNamespaceTablesInput): ns is SqlNamespace {
  if (typeof ns !== 'object' || ns === null) {
    return false;
  }
  const proto = Object.getPrototypeOf(ns);
  if (proto === Object.prototype || proto === null) {
    return false;
  }
  return (ns as Namespace).kind === SQL_NAMESPACE_KIND;
}

function freezeSqlEntries(input: SqlNamespaceTablesInput['entries']): SqlBoundNamespace['entries'] {
  const table = Object.freeze(
    Object.fromEntries(
      Object.entries(input?.table ?? {}).map(([name, t]) => [
        name,
        t instanceof StorageTable ? t : new StorageTable(t),
      ]),
    ),
  );
  const typeSlot = input?.type;
  if (typeSlot === undefined || Object.keys(typeSlot).length === 0) {
    return Object.freeze({ table });
  }
  return Object.freeze({ table, type: Object.freeze({ ...typeSlot }) });
}

class SqlBoundNamespace extends NamespaceBase {
  declare readonly kind: string;

  readonly id: string;
  readonly entries: Readonly<{
    readonly table: Readonly<Record<string, StorageTable>>;
    readonly type?: Readonly<Record<string, PostgresEnumStorageEntry>>;
  }>;

  static fromTablesInput(input: SqlNamespaceTablesInput): SqlNamespace {
    const tableCount = Object.keys(input.entries?.table ?? {}).length;
    const typeCount = Object.keys(input.entries?.type ?? {}).length;
    if (input.id === UNBOUND_NAMESPACE_ID && tableCount === 0 && typeCount === 0) {
      return castAs<SqlNamespace>(SqlUnboundNamespace.instance);
    }
    return castAs<SqlNamespace>(new SqlBoundNamespace(input));
  }

  private constructor(input: SqlNamespaceTablesInput) {
    super();
    this.id = input.id;
    this.entries = freezeSqlEntries(input.entries);
    Object.defineProperty(this, 'kind', {
      value: SQL_NAMESPACE_KIND,
      writable: false,
      enumerable: false,
      configurable: true,
    });
    freezeNode(this);
  }

  qualifyTable(tableName: string): string {
    if (this.id === UNBOUND_NAMESPACE_ID) {
      return `"${tableName}"`;
    }
    return `"${this.id}"."${tableName}"`;
  }
}

export function buildSqlNamespace(input: SqlNamespaceTablesInput): SqlNamespace {
  return SqlBoundNamespace.fromTablesInput(input);
}

export function buildSqlNamespaceMap(
  namespaces: Readonly<Record<string, Namespace | SqlNamespaceTablesInput>>,
): Readonly<Record<string, SqlNamespace>> {
  return Object.fromEntries(
    Object.entries(namespaces).map(([nsKey, ns]) => [
      nsKey,
      isMaterializedSqlNamespace(ns)
        ? blindCast<
            SqlNamespace,
            'a materialised SQL-family namespace entry in a namespace map is a SqlNamespace'
          >(ns)
        : SqlBoundNamespace.fromTablesInput(ns),
    ]),
  );
}
