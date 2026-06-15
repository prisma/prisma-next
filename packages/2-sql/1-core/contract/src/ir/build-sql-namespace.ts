import {
  freezeNode,
  hydrateNamespaceEntities,
  type Namespace,
  NamespaceBase,
  UNBOUND_NAMESPACE_ID,
} from '@prisma-next/framework-components/ir';
import { blindCast } from '@prisma-next/utils/casts';
import { composeSqlEntityKinds } from '../entity-kinds';
import type { SqlNamespace, SqlNamespaceEntries, SqlNamespaceTablesInput } from './sql-storage';
import { SqlUnboundNamespace } from './sql-unbound-namespace';
import type { StorageTable } from './storage-table';
import type { StorageValueSet } from './storage-value-set';

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
    const tableKind = input.entries['table'];
    const tableCount = tableKind !== undefined ? Object.keys(tableKind).length : 0;
    const valueSetKind = input.entries['valueSet'];
    const hasValueSets = valueSetKind !== undefined && Object.keys(valueSetKind).length > 0;
    const hasUnknownKinds = Object.keys(input.entries).some(
      (kind) => kind !== 'table' && kind !== 'valueSet',
    );
    if (
      input.id === UNBOUND_NAMESPACE_ID &&
      tableCount === 0 &&
      !hasValueSets &&
      !hasUnknownKinds
    ) {
      return SqlUnboundNamespace.instance;
    }
    return new SqlBoundNamespace(input);
  }

  private constructor(input: SqlNamespaceTablesInput) {
    super();
    this.id = input.id;

    const dispatched = hydrateNamespaceEntities(input.entries, composeSqlEntityKinds(), 'carry');

    this.entries = Object.freeze(
      blindCast<
        SqlNamespaceEntries,
        'composeSqlEntityKinds() supplies table→StorageTable and valueSet→StorageValueSet descriptors, so this open-dict result holds exactly the typed members SqlNamespaceEntries declares; the descriptor Map erases those per-kind Node types from the return.'
      >(dispatched),
    );
    Object.defineProperty(this, 'kind', {
      value: SQL_NAMESPACE_KIND,
      writable: false,
      enumerable: false,
      configurable: true,
    });
    freezeNode(this);
  }

  get table(): Readonly<Record<string, StorageTable>> {
    return this.entries.table ?? Object.freeze({});
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
        ? ns
        : SqlBoundNamespace.fromTablesInput(
            blindCast<
              SqlNamespaceTablesInput,
              'non-materialized SQL namespace map entry is a SqlNamespaceTablesInput'
            >(ns),
          ),
    ]),
  );
}
