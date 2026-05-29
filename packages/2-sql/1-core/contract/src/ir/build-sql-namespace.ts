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

class SqlNamespaceFromTablesInput extends NamespaceBase {
  declare readonly kind: string;
  declare readonly enum?: Readonly<Record<string, PostgresEnumStorageEntry>>;

  readonly id: string;
  readonly tables: Readonly<Record<string, StorageTable>>;

  constructor(input: SqlNamespaceTablesInput) {
    super();
    this.id = input.id;
    this.tables = Object.freeze(
      Object.fromEntries(
        Object.entries(input.tables ?? {}).map(([name, t]) => [
          name,
          t instanceof StorageTable ? t : new StorageTable(t),
        ]),
      ),
    );
    if (input.enum !== undefined && Object.keys(input.enum).length > 0) {
      Object.defineProperty(this, 'enum', {
        value: Object.freeze({ ...input.enum }),
        writable: false,
        enumerable: true,
        configurable: false,
      });
    }
    Object.defineProperty(this, 'kind', {
      value: 'sql-namespace',
      writable: false,
      enumerable: false,
      configurable: true,
    });
    freezeNode(this);
  }
}

export function buildSqlNamespace(input: SqlNamespaceTablesInput): SqlNamespace {
  const tableCount = Object.keys(input.tables ?? {}).length;
  const enumCount = Object.keys(input.enum ?? {}).length;
  if (input.id === UNBOUND_NAMESPACE_ID && tableCount === 0 && enumCount === 0) {
    return castAs<SqlNamespace>(SqlUnboundNamespace.instance);
  }
  return castAs<SqlNamespace>(new SqlNamespaceFromTablesInput(input));
}

export function buildSqlNamespaceMap(
  namespaces: Readonly<Record<string, Namespace | SqlNamespaceTablesInput>>,
): Readonly<Record<string, SqlNamespace>> {
  return Object.fromEntries(
    Object.entries(namespaces).map(([nsKey, ns]) => [
      nsKey,
      ns instanceof NamespaceBase
        ? blindCast<
            SqlNamespace,
            'an already-built NamespaceBase in an SQL-family namespace map is a SqlNamespace'
          >(ns)
        : buildSqlNamespace(ns),
    ]),
  );
}
