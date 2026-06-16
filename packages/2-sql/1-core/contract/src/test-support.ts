import {
  freezeNode,
  hydrateNamespaceEntities,
  UNBOUND_NAMESPACE_ID,
} from '@prisma-next/framework-components/ir';
import { blindCast } from '@prisma-next/utils/casts';
import { composeSqlEntityKinds } from './entity-kinds';
import {
  SqlNamespace,
  type SqlNamespaceEntries,
  type SqlNamespaceTablesInput,
} from './ir/sql-storage';
import { SqlUnboundNamespace } from './ir/sql-unbound-namespace';
import type { StorageTable } from './ir/storage-table';
import type { StorageValueSet } from './ir/storage-value-set';

/**
 * Minimal concrete `SqlNamespace` for use in `packages/2-sql/**` unit tests.
 *
 * This is a legitimate target concretion — not a materialised family
 * namespace.  Production code never constructs one; the target-specific
 * concretions (`PostgresSchema`, `SqliteDatabase`) are used in production.
 */
export class TestSqlNamespace extends SqlNamespace {
  declare readonly kind: 'test-sql-namespace';
  readonly id: string;
  readonly entries: SqlNamespaceEntries;

  constructor(input: SqlNamespaceTablesInput) {
    super();
    this.id = input.id;
    const dispatched = hydrateNamespaceEntities(input.entries, composeSqlEntityKinds(), 'carry');
    this.entries = Object.freeze(
      blindCast<
        SqlNamespaceEntries,
        'composeSqlEntityKinds() supplies table→StorageTable and valueSet→StorageValueSet descriptors'
      >(dispatched),
    );
    Object.defineProperty(this, 'kind', {
      value: 'test-sql-namespace',
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

export function createTestSqlNamespace(input: SqlNamespaceTablesInput): SqlNamespace {
  if (input.id === UNBOUND_NAMESPACE_ID && Object.keys(input.entries).length === 0) {
    return SqlUnboundNamespace.instance;
  }
  return new TestSqlNamespace(input);
}
