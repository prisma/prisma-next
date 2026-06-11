import {
  freezeNode,
  type Namespace,
  NamespaceBase,
  UNBOUND_NAMESPACE_ID,
} from '@prisma-next/framework-components/ir';
import { blindCast, castAs } from '@prisma-next/utils/casts';
import type { SqlNamespace, SqlNamespaceEntries, SqlNamespaceTablesInput } from './sql-storage';
import { SqlUnboundNamespace } from './sql-unbound-namespace';
import { StorageTable, type StorageTableInput } from './storage-table';
import { StorageValueSet, type StorageValueSetInput } from './storage-value-set';

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

class SqlBoundNamespace extends NamespaceBase {
  declare readonly kind: string;

  readonly id: string;
  readonly entries: SqlNamespaceEntries;

  static fromTablesInput(input: SqlNamespaceTablesInput): SqlNamespace {
    const unknownKinds = Object.keys(input.entries).filter(
      (kind) => kind !== 'table' && kind !== 'valueSet',
    );
    if (unknownKinds.length > 0) {
      throw new Error(
        `buildSqlNamespace: unknown entity kind(s) ${unknownKinds.map((k) => JSON.stringify(k)).join(', ')} in entries; expected "table" or "valueSet"`,
      );
    }
    const tableKind = input.entries['table'];
    const tableCount = tableKind !== undefined ? Object.keys(tableKind).length : 0;
    const valueSetKind = input.entries['valueSet'];
    const hasValueSets = valueSetKind !== undefined && Object.keys(valueSetKind).length > 0;
    if (input.id === UNBOUND_NAMESPACE_ID && tableCount === 0 && !hasValueSets) {
      return castAs<SqlNamespace>(SqlUnboundNamespace.instance);
    }
    return castAs<SqlNamespace>(new SqlBoundNamespace(input));
  }

  private constructor(input: SqlNamespaceTablesInput) {
    super();
    this.id = input.id;

    const builtEntries: Record<string, Readonly<Record<string, unknown>>> = {};
    for (const [kind, rawMap] of Object.entries(input.entries)) {
      if (kind === 'table') {
        const tableMap: Record<string, StorageTable> = {};
        for (const [name, v] of Object.entries(
          blindCast<
            Record<string, StorageTableInput>,
            'entries[table] holds StorageTableInput by construction'
          >(rawMap),
        )) {
          tableMap[name] = new StorageTable(v);
        }
        builtEntries['table'] = Object.freeze(tableMap);
      } else if (kind === 'valueSet') {
        const vsMap: Record<string, StorageValueSet> = {};
        for (const [name, v] of Object.entries(
          blindCast<
            Record<string, StorageValueSetInput>,
            'entries[valueSet] holds StorageValueSetInput by construction'
          >(rawMap),
        )) {
          vsMap[name] = new StorageValueSet(v);
        }
        builtEntries['valueSet'] = Object.freeze(vsMap);
      } else {
        throw new Error(
          `buildSqlNamespace: unknown entity kind "${kind}" in entries; expected "table" or "valueSet"`,
        );
      }
    }

    if (!Object.hasOwn(builtEntries, 'table')) {
      builtEntries['table'] = Object.freeze({});
    }

    this.entries = Object.freeze(builtEntries) as SqlNamespaceEntries;
    Object.defineProperty(this, 'kind', {
      value: SQL_NAMESPACE_KIND,
      writable: false,
      enumerable: false,
      configurable: true,
    });
    freezeNode(this);
  }

  get table(): Readonly<Record<string, StorageTable>> {
    return blindCast<
      Readonly<Record<string, StorageTable>>,
      'entries[table] holds only StorageTable by construction'
    >(this.entries['table'] ?? Object.freeze({}));
  }

  get valueSet(): Readonly<Record<string, StorageValueSet>> | undefined {
    return this.entries.valueSet;
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
        : SqlBoundNamespace.fromTablesInput(
            blindCast<
              SqlNamespaceTablesInput,
              'non-materialized SQL namespace map entry is a SqlNamespaceTablesInput'
            >(ns),
          ),
    ]),
  );
}
