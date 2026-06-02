import type { Contract } from '@prisma-next/contract/types';
import { SqlContractSerializerBase } from '@prisma-next/family-sql/ir';
import {
  type Namespace,
  NamespaceBase,
  UNBOUND_NAMESPACE_ID,
} from '@prisma-next/framework-components/ir';
import type {
  SqlNamespaceTablesInput,
  SqlStorage,
  StorageTable,
} from '@prisma-next/sql-contract/types';
import { SqliteDatabase, SqliteUnboundDatabase } from './sqlite-unbound-database';

/**
 * SQLite target `ContractSerializer` concretion. Mirrors the Postgres
 * shape: inherits the full SQL-family deserialization pipeline and
 * materialises namespace entries as SQLite database concretions that
 * expose `qualifyTable()` for runtime SQL rendering.
 */
export class SqliteContractSerializer extends SqlContractSerializerBase<Contract<SqlStorage>> {
  constructor() {
    super(new Map());
  }

  protected override hydrateSqlNamespaceEntry(
    nsId: string,
    raw: Namespace | Record<string, unknown>,
  ): Namespace | SqlNamespaceTablesInput {
    if (raw instanceof NamespaceBase) {
      return raw;
    }
    const hydrated = super.hydrateSqlNamespaceEntry(nsId, raw) as {
      id: string;
      tables: Readonly<Record<string, StorageTable>>;
    };
    const { id, tables } = hydrated;
    const emptyTables = Object.keys(tables).length === 0;
    if (id === UNBOUND_NAMESPACE_ID && emptyTables) {
      return SqliteUnboundDatabase.instance;
    }
    if (id !== UNBOUND_NAMESPACE_ID) {
      throw new Error(
        `SqliteContractSerializer: SQLite has no schema concept; the only valid namespace id is "${UNBOUND_NAMESPACE_ID}" (received "${id}").`,
      );
    }
    return new SqliteDatabase({ id, tables });
  }
}
