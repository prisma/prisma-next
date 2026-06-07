import {
  freezeNode,
  type Namespace,
  NamespaceBase,
  UNBOUND_NAMESPACE_ID,
} from '@prisma-next/framework-components/ir';
import { blindCast, castAs } from '@prisma-next/utils/casts';
import type { SqlNamespace, SqlNamespaceTablesInput } from './sql-storage';
import { SqlUnboundNamespace } from './sql-unbound-namespace';
import { StorageTable } from './storage-table';
import { StorageValueSet } from './storage-value-set';

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
  readonly entries: Readonly<{
    readonly table: Readonly<Record<string, StorageTable>>;
    readonly valueSet?: Readonly<Record<string, StorageValueSet>>;
  }>;

  static fromTablesInput(input: SqlNamespaceTablesInput): SqlNamespace {
    const tableCount = Object.keys(input.entries.table).length;
    const hasValueSets =
      input.entries.valueSet !== undefined && Object.keys(input.entries.valueSet).length > 0;
    if (input.id === UNBOUND_NAMESPACE_ID && tableCount === 0 && !hasValueSets) {
      return castAs<SqlNamespace>(SqlUnboundNamespace.instance);
    }
    return castAs<SqlNamespace>(new SqlBoundNamespace(input));
  }

  private constructor(input: SqlNamespaceTablesInput) {
    super();
    this.id = input.id;
    const table = Object.freeze(
      Object.fromEntries(
        Object.entries(input.entries.table).map(([k, v]) => [k, new StorageTable(v)]),
      ),
    );
    if (input.entries.valueSet !== undefined) {
      const valueSet = Object.freeze(
        Object.fromEntries(
          Object.entries(input.entries.valueSet).map(([k, v]) => [k, new StorageValueSet(v)]),
        ),
      );
      this.entries = Object.freeze({ table, valueSet });
    } else {
      this.entries = Object.freeze({ table });
    }
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
        : SqlBoundNamespace.fromTablesInput(
            blindCast<
              SqlNamespaceTablesInput,
              'non-materialized SQL namespace map entry is a SqlNamespaceTablesInput'
            >(ns),
          ),
    ]),
  );
}
